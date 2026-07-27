'use strict';

const axios = require('axios');

const BASE = 'https://graph.facebook.com';

/**
 * Send messages *as* the E2E customer WABA to the Test business display number.
 * Real Meta Cloud API — no mocks in live runs.
 */
function createGraphCustomer(cfg) {
  const version = cfg.graphApiVersion || 'v21.0';
  const url = `${BASE}/${version}/${cfg.customerPhoneNumberId}/messages`;
  const headers = { Authorization: `Bearer ${cfg.customerAccessToken}` };

  async function sendText(toBusinessDisplay, body) {
    const to = String(toBusinessDisplay).replace(/^\+/, '');
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: false, body: String(body) },
    };
    try {
      const res = await axios.post(url, payload, { headers });
      return res.data?.messages?.[0]?.id ?? null;
    } catch (err) {
      throw graphHttpError(err, `POST ${url}`);
    }
  }

  /**
   * Customer taps a reply button (interactive button_reply inbound shape when *receiving*;
   * when *sending* as Cloud API user, text is the usual path for chat-native UX).
   * Prefer sendText with the button title for chat-native bots; keep this for future.
   */
  async function sendInteractiveButtonReply(toBusinessDisplay, { id, title }) {
    // Meta Cloud API does not expose "simulate button tap" for a consumer;
    // send the button title as text (matches how users type numbered/menu replies).
    return sendText(toBusinessDisplay, title || id);
  }

  return { sendText, sendInteractiveButtonReply, url };
}

/**
 * Surface Meta Graph error JSON instead of opaque axios "status code 400".
 * @param {import('axios').AxiosError} err
 * @param {string} hint
 */
function graphHttpError(err, hint) {
  const status = err.response?.status;
  const data = err.response?.data;
  const meta = data?.error;
  const detail = meta
    ? `Graph ${meta.code}/${meta.error_subcode || '-'}: ${meta.message}`
    : (typeof data === 'string' ? data : JSON.stringify(data || err.message));
  const e = new Error(`${hint} failed (${status}): ${detail}`);
  e.cause = err;
  e.response = err.response;
  return e;
}

module.exports = { createGraphCustomer, graphHttpError };
