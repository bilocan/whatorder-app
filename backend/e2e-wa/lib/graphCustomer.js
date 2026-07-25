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
    const res = await axios.post(url, payload, { headers });
    return res.data?.messages?.[0]?.id ?? null;
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

module.exports = { createGraphCustomer };
