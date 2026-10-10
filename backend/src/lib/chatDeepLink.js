/** Deep-link token in WhatsApp prefill: ORDER {businessId} (space; + also accepted on receive). */
const ORDER_PREFIX_RE = /^ORDER[\s+]+([A-Za-z0-9_-]+)\s*$/i;
const CHANNEL_TAG_RE = /\s#wo:(qr|map|web)\s*$/i;
const CHANNELS = new Set(['qr', 'map', 'web']);

function parseOrderDeepLink(text, businessIds = []) {
  const trimmed = (text ?? '').trim();
  const match = trimmed.match(ORDER_PREFIX_RE);
  if (!match) return null;
  const token = match[1];
  return businessIds.find((id) => id.toLowerCase() === token.toLowerCase()) ?? null;
}

function buildOrderDeepLinkPrefill(businessId) {
  return `ORDER ${businessId}`;
}

function chatPrefillFromQuery(query = {}) {
  const bid = typeof query.bid === 'string' ? query.bid.trim() : '';
  if (bid) return buildOrderDeepLinkPrefill(bid);
  const fromText = typeof query.text === 'string' ? query.text.trim() : '';
  if (fromText) return fromText;
  return null;
}

function isOrderDeepLink(text) {
  return ORDER_PREFIX_RE.test((text ?? '').trim());
}

function stripWallboardChannel(text) {
  const raw = text ?? '';
  const match = String(raw).match(CHANNEL_TAG_RE);
  if (!match) return { text: raw, channel: null };
  return {
    text: String(raw).slice(0, match.index).trimEnd(),
    channel: match[1].toLowerCase(),
  };
}

function appendWallboardChannel(prefill, ch) {
  const value = typeof ch === 'string' ? ch.trim().toLowerCase() : '';
  if (value && !CHANNELS.has(value)) return prefill;
  const channel = CHANNELS.has(value) ? value : 'qr';
  return `${prefill} #wo:${channel}`;
}

module.exports = {
  parseOrderDeepLink,
  buildOrderDeepLinkPrefill,
  chatPrefillFromQuery,
  isOrderDeepLink,
  stripWallboardChannel,
  appendWallboardChannel,
  ORDER_PREFIX_RE,
};
