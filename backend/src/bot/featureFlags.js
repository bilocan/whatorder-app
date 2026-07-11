/**
 * Per-business bot feature flags (Firestore `businesses/{bid}` fields).
 * Conversational basket is the default ordering mode; set `conversationalBasket: false`
 * on a business doc to opt out to legacy browse-first paths. Legacy paths remain
 * in code until a later cleanup — only the default changed.
 */

function isConversationalBasket(business) {
  if (!business) return false;
  return business.conversationalBasket !== false;
}

module.exports = {
  isConversationalBasket,
};
