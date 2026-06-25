/** Deep-link token in WhatsApp prefill: ORDER {businessId} (space; + also accepted on receive). */
const ORDER_PREFIX_RE = /^ORDER[\s+]+([A-Za-z0-9_-]+)\s*$/i;

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

module.exports = {
  parseOrderDeepLink,
  buildOrderDeepLinkPrefill,
  chatPrefillFromQuery,
  isOrderDeepLink,
  ORDER_PREFIX_RE,
};
