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

module.exports = {
  businessRef, menuRef, ordersRef, customersRef,
  phoneRoutingRef,
  ownerRef, adminRef,
  sessionRef,
  processedMessageRef,
};
