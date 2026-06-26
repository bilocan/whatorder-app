const { db } = require('./firebase');

const businessRef = (businessId) =>
  db.collection('businesses').doc(businessId);

const menuRef = (businessId) =>
  businessRef(businessId).collection('menu');

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

// config/whatorder → { feeType, feeValue }
const configRef = () =>
  db.collection('config').doc('whatorder');

// businesses/{businessId}/intentLearnings/{keyHash} — Tier B → Tier A validated parses
const intentLearningRef = (businessId, keyHash) =>
  businessRef(businessId).collection('intentLearnings').doc(keyHash);

module.exports = {
  businessRef, menuRef, ordersRef, customersRef,
  phoneRoutingRef, phoneRoutingByBusinessQuery,
  ownerRef, adminRef,
  sessionRef,
  processedMessageRef,
  stripeEventRef,
  configRef,
  intentLearningRef,
};
