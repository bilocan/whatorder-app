const { db } = require('./firebase');

const businessesCollectionRef = () => db.collection('businesses');

const businessRef = (businessId) =>
  businessesCollectionRef().doc(businessId);

const menuRef = (businessId) =>
  businessRef(businessId).collection('menu');

// businesses/{businessId}/optionGroups/{groupId} — reusable WhatsApp customization groups
const optionGroupsRef = (businessId) =>
  businessRef(businessId).collection('optionGroups');

const ordersRef = (businessId) =>
  businessRef(businessId).collection('orders');

const customersRef = (businessId) =>
  businessRef(businessId).collection('customers');

// phoneRouting/{phoneNumberId} → { businessId }
const phoneRoutingRef = (phoneNumberId) =>
  db.collection('phoneRouting').doc(phoneNumberId);

const phoneRoutingByBusinessQuery = (businessId) =>
  db.collection('phoneRouting').where('businessIds', 'array-contains', businessId).limit(10);

// owners/{uid} → { businessId }  (which business this Firebase Auth user owns)
const ownerRef = (uid) =>
  db.collection('owners').doc(uid);

// admins/{uid} → {} (flag doc — existence means the user is a super-admin)
const adminRef = (uid) =>
  db.collection('admins').doc(uid);

// sessions/{phone} → { state, language, basket, businessId, updatedAt }
const sessionRef = (phone) =>
  db.collection('sessions').doc(phone);

// processedMessages/{wamid} → { processedAt, businessId }  (idempotency guard for WhatsApp webhooks)
const processedMessageRef = (wamid) =>
  db.collection('processedMessages').doc(wamid);

// stripeEvents/{eventId} → { type, processedAt }  (idempotency guard for Stripe webhooks)
const stripeEventRef = (eventId) =>
  db.collection('stripeEvents').doc(eventId);

// config/whatorder → { feeType, feeValue, aiIntentEnabled?, llmProvider?, llmModel?, llmFallbackProvider?, llmFallbackModel?, llmLastSuccessAt?, llmLastAttemptAt?, llmLastProvider?, llmLastModel?, llmLastLatencyMs?, llmLastOk?, llmLastError?, llmDailyDate?, llmDailyCalls?, llmDailyAttempts? }
const configRef = () =>
  db.collection('config').doc('whatorder');

// config/settlement → hold, batch schedule, connect mode
const settlementConfigRef = () =>
  db.collection('config').doc('settlement');

// payouts/{payoutId} → weekly batch per restaurant
const payoutsRef = () =>
  db.collection('payouts');

const payoutRef = (payoutId) =>
  payoutsRef().doc(payoutId);

// businesses/{businessId}/intentLearnings/{keyHash} — Tier B → Tier A validated parses
const intentLearningRef = (businessId, keyHash) =>
  businessRef(businessId).collection('intentLearnings').doc(keyHash);

// businesses/{businessId}/seededIntents/{keyHash} — archive of learnings shipped in the app seed
const seededIntentRef = (businessId, keyHash) =>
  businessRef(businessId).collection('seededIntents').doc(keyHash);

// businesses/{businessId}/config/seedOverrides → { textKeys: [] } — corrections that shadow the baked seed
const seedOverridesRef = (businessId) =>
  businessRef(businessId).collection('config').doc('seedOverrides');

// commandLearnings/{keyHash} — global LLM-classified bot commands (view_basket, undo)
const commandLearningRef = (keyHash) =>
  db.collection('commandLearnings').doc(keyHash);

module.exports = {
  businessesCollectionRef,
  businessRef, menuRef, optionGroupsRef, ordersRef, customersRef,
  phoneRoutingRef, phoneRoutingByBusinessQuery,
  ownerRef, adminRef,
  sessionRef,
  processedMessageRef,
  stripeEventRef,
  configRef,
  settlementConfigRef,
  payoutsRef,
  payoutRef,
  intentLearningRef,
  seededIntentRef,
  seedOverridesRef,
  commandLearningRef,
};
