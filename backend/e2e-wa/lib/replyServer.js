'use strict';

const express = require('express');
const axios = require('axios');

/**
 * Meta Cloud API webhook for the *customer* WABA.
 * Inbound messages (bot replies to the E2E customer) land in ReplyBuffer.
 *
 * Path is /webhooks/customer only — do not use /webhooks/whatsapp (that is the
 * business bot webhook on local/Test Cloud Run).
 *
 * Optional `/webhooks/business-sniff` + phone-level Meta webhook override: logs
 * business outbound status errors, then forwards to Test Cloud Run so live
 * traffic is not dropped.
 *
 * @param {{ buffer: import('./replyBuffer').ReplyBuffer, verifyToken: string }} opts
 */
function createReplyApp(opts) {
  const { buffer, verifyToken } = opts;
  const statuses = [];
  const businessSniffStatuses = [];
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
      ingestWebhook(buffer, statuses, req.body);
    } catch (err) {
      console.error('[e2e-wa reply] ingest error', err.message);
    }
  });

  /** Accept Meta verify for temporary business phone webhook overrides. */
  app.get('/webhooks/business-sniff', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const alt = process.env.E2E_WA_BUSINESS_SNIFF_VERIFY_TOKEN || verifyToken;
    if (mode === 'subscribe' && (token === verifyToken || token === alt)) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  });

  /**
   * Temporary override target for the restaurant phone. Logs status errors,
   * then forwards the raw body to Test Cloud Run.
   */
  app.post('/webhooks/business-sniff', async (req, res) => {
    res.sendStatus(200);
    try {
      // Do not push business inbound messages into the customer reply buffer.
      for (const entry of req.body?.entry || []) {
        for (const change of entry.changes || []) {
          for (const st of change.value?.statuses || []) {
            const row = {
              id: st.id,
              status: st.status,
              recipient_id: st.recipient_id,
              timestamp: Number(st.timestamp) * 1000 || Date.now(),
              errors: st.errors || [],
              raw: st,
            };
            businessSniffStatuses.push(row);
            if (st.status === 'failed') {
              console.log(
                '[e2e-wa business-sniff] FAILED',
                JSON.stringify({
                  id: st.id,
                  recipient_id: st.recipient_id,
                  errors: st.errors,
                }),
              );
            } else {
              console.log(
                '[e2e-wa business-sniff] status',
                st.status,
                st.id,
                st.recipient_id,
              );
            }
          }
        }
      }
    } catch (err) {
      console.error('[e2e-wa business-sniff] ingest error', err.message);
    }
    const forwardUrl =
      process.env.E2E_WA_BUSINESS_SNIFF_FORWARD_URL
      || 'https://whatorder-backend-6ehqrvd7yq-ey.a.run.app/webhooks/whatsapp';
    try {
      const headers = { 'Content-Type': 'application/json' };
      const sig = req.get('x-hub-signature-256');
      if (sig) headers['X-Hub-Signature-256'] = sig;
      await axios.post(forwardUrl, req.body, {
        headers,
        timeout: 10_000,
        validateStatus: () => true,
      });
    } catch (err) {
      console.error('[e2e-wa business-sniff] forward error', err.message);
    }
  });

  app.get('/business-sniff-statuses', (req, res) => {
    const afterTs = Number(req.query.afterTs || 0);
    res.json({ statuses: businessSniffStatuses.filter((s) => s.timestamp > afterTs) });
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, buffered: buffer.messages.length, statuses: statuses.length });
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

  /** Outbound delivery statuses for Graph sends from the E2E customer number. */
  app.get('/statuses', (req, res) => {
    const afterTs = Number(req.query.afterTs || 0);
    const matches = statuses.filter((s) => s.timestamp > afterTs);
    res.json({ statuses: matches });
  });

  return app;
}

function ingestWebhook(buffer, statusesOrBody, maybeBody) {
  // Back-compat: ingestWebhook(buffer, body)
  const statuses = maybeBody === undefined && !Array.isArray(statusesOrBody)
    ? []
    : (statusesOrBody || []);
  const body = maybeBody === undefined ? statusesOrBody : maybeBody;
  const entries = body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        const entryMsg = {
          id: message.id,
          from: message.from,
          type: message.type,
          text: extractText(message),
          timestamp: Number(message.timestamp) * 1000 || Date.now(),
          raw: message,
        };
        buffer.push(entryMsg);
        console.log(
          '[e2e-wa reply] message',
          `from=${entryMsg.from}`,
          `type=${entryMsg.type}`,
          `text=${String(entryMsg.text).slice(0, 80)}`,
        );
      }
      for (const st of value.statuses || []) {
        const row = {
          id: st.id,
          status: st.status,
          recipient_id: st.recipient_id,
          timestamp: Number(st.timestamp) * 1000 || Date.now(),
          errors: st.errors || [],
          raw: st,
        };
        statuses.push(row);
        const errHint = (st.errors || [])
          .map((e) => `${e.code}:${e.title || e.message || ''}`)
          .join(',') || '-';
        console.log(
          '[e2e-wa reply] status',
          `id=${st.id}`,
          `status=${st.status}`,
          `to=${st.recipient_id}`,
          `errors=${errHint}`,
        );
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
