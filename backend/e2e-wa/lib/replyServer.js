'use strict';

const express = require('express');

/**
 * Meta Cloud API webhook for the *customer* WABA.
 * Inbound messages (bot replies to the E2E customer) land in ReplyBuffer.
 *
 * Path is /webhooks/customer only — do not use /webhooks/whatsapp (that is the
 * business bot webhook on local/Test Cloud Run).
 *
 * @param {{ buffer: import('./replyBuffer').ReplyBuffer, verifyToken: string }} opts
 */
function createReplyApp(opts) {
  const { buffer, verifyToken } = opts;
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/webhooks/customer', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  app.post('/webhooks/customer', (req, res) => {
    res.sendStatus(200);
    try {
      ingestWebhook(buffer, req.body);
    } catch (err) {
      console.error('[e2e-wa reply] ingest error', err.message);
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, buffered: buffer.messages.length });
  });

  /** Poll helper for runners that do not share the in-process buffer. */
  app.get('/replies', (req, res) => {
    const afterTs = Number(req.query.afterTs || 0);
    const includes = req.query.includes;
    const from = req.query.from;
    const matches = buffer.messages.filter((m) => {
      if (m.timestamp <= afterTs) return false;
      if (from) {
        const a = m.from.replace(/^\+/, '');
        const b = String(from).replace(/^\+/, '');
        if (a !== b) return false;
      }
      if (includes) {
        const re = includes.startsWith('/')
          ? null
          : includes;
        if (re && !m.text.toLowerCase().includes(String(re).toLowerCase())) return false;
      }
      return true;
    });
    res.json({ messages: matches });
  });

  return app;
}

function ingestWebhook(buffer, body) {
  const entries = body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        buffer.push({
          id: message.id,
          from: message.from,
          type: message.type,
          text: extractText(message),
          timestamp: Number(message.timestamp) * 1000 || Date.now(),
          raw: message,
        });
      }
    }
  }
}

function extractText(message) {
  if (message.type === 'text') return message.text?.body || '';
  if (message.type === 'button') return message.button?.text || message.button?.payload || '';
  if (message.type === 'interactive') {
    const ir = message.interactive;
    if (ir?.type === 'button_reply') return ir.button_reply?.title || ir.button_reply?.id || '';
    if (ir?.type === 'list_reply') return ir.list_reply?.title || ir.list_reply?.id || '';
  }
  return JSON.stringify(message);
}

module.exports = { createReplyApp, ingestWebhook, extractText };
