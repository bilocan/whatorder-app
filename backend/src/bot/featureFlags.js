/**
 * Per-business bot feature flags (Firestore `businesses/{bid}` fields).
 * Default off — callers must gate new behavior behind these helpers.
 */

function isConversationalBasket(business) {
  return business?.conversationalBasket === true;
}

module.exports = {
  isConversationalBasket,
};
