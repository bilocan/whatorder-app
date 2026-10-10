const crypto = require('crypto');
const { db, admin } = require('./firebase');
const { wallboardChatRef, wallboardChatKeyRef, customersRef } = require('./collections');
const { normalizeCustomerPhone } = require('./phone');
const { getSession } = require('../bot/sessionStore');
const { getBusinessInfo } = require('../bot/menuService');

const CHAT_FAIL = '[wallboard] chat write failed';

function viennaDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function chatKeyId(phone, secret) {
  return crypto.createHmac('sha256', secret).update(phone).digest('hex');
}

function failChat() {
  console.error(CHAT_FAIL);
}

async function customerExists(tx, businessIds, phone) {
  for (const bid of businessIds) {
    const snap = await tx.get(customersRef(bid).doc(phone));
    if (snap.exists) return true;
  }
  return false;
}

async function recordWallboardInbound({ phone, channel, businessIds, businessId, restaurantName }) {
  const digits = normalizeCustomerPhone(phone);
  const secret = process.env.WALLBOARD_CHAT_HASH_KEY;
  if (!digits || !secret) {
    failChat();
    return;
  }
  const keyRef = wallboardChatKeyRef(chatKeyId(digits, secret));
  const dayKey = viennaDayKey(new Date());
  try {
    await db.runTransaction(async (tx) => {
      const keySnap = await tx.get(keyRef);
      const key = keySnap.exists ? keySnap.data() : null;
      if (key && key.dayKey === dayKey && key.chatId) {
        const chatRef = wallboardChatRef(key.chatId);
        const chatSnap = await tx.get(chatRef);
        const chat = chatSnap.exists ? chatSnap.data() : null;
        if (!chat || chat.ordered === true || !businessId) return;
        if (chat.businessId === businessId && chat.restaurantName === (restaurantName || null)) return;
        tx.set(chatRef, {
          businessId,
          restaurantName: restaurantName || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
      }
      const seenBefore = !!key;
      const returning = seenBefore || await customerExists(tx, businessIds || [], digits);
      const chatId = crypto.randomUUID();
      tx.set(wallboardChatRef(chatId), {
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        channel: channel || 'direct',
        newNumber: !returning,
        businessId: businessId || null,
        restaurantName: businessId ? (restaurantName || null) : null,
        ordered: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(keyRef, {
        firstSeenAt: key && key.firstSeenAt
          ? key.firstSeenAt
          : admin.firestore.FieldValue.serverTimestamp(),
        dayKey,
        chatId,
      });
    });
  } catch (_err) {
    failChat();
  }
}

async function markWallboardChatOrdered({ phone, businessId, restaurantName }) {
  const digits = normalizeCustomerPhone(phone);
  const secret = process.env.WALLBOARD_CHAT_HASH_KEY;
  if (!digits || !secret) {
    failChat();
    return;
  }
  const keyRef = wallboardChatKeyRef(chatKeyId(digits, secret));
  const dayKey = viennaDayKey(new Date());
  try {
    await db.runTransaction(async (tx) => {
      const keySnap = await tx.get(keyRef);
      const key = keySnap.exists ? keySnap.data() : null;
      if (!key || key.dayKey !== dayKey || !key.chatId) return;
      const chatRef = wallboardChatRef(key.chatId);
      const chatSnap = await tx.get(chatRef);
      const chat = chatSnap.exists ? chatSnap.data() : null;
      if (!chat || chat.ordered === true) return;
      tx.set(chatRef, {
        ordered: true,
        businessId: businessId || chat.businessId || null,
        restaurantName: restaurantName || chat.restaurantName || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (_err) {
    failChat();
  }
}

async function updateRestaurant({ phone, businessId, restaurantName }) {
  const digits = normalizeCustomerPhone(phone);
  const secret = process.env.WALLBOARD_CHAT_HASH_KEY;
  if (!digits || !secret || !businessId) {
    if (!secret) failChat();
    return;
  }
  const keyRef = wallboardChatKeyRef(chatKeyId(digits, secret));
  const dayKey = viennaDayKey(new Date());
  try {
    await db.runTransaction(async (tx) => {
      const keySnap = await tx.get(keyRef);
      const key = keySnap.exists ? keySnap.data() : null;
      if (!key || key.dayKey !== dayKey || !key.chatId) return;
      const chatRef = wallboardChatRef(key.chatId);
      const chatSnap = await tx.get(chatRef);
      const chat = chatSnap.exists ? chatSnap.data() : null;
      if (!chat || chat.ordered === true) return;
      if (chat.businessId === businessId && chat.restaurantName === (restaurantName || null)) return;
      tx.set(chatRef, {
        businessId,
        restaurantName: restaurantName || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (_err) {
    failChat();
  }
}

function restaurantIdFromSession(session) {
  if (!session) return null;
  // Language re-prompt keeps the previous businessId. The link they just
  // opened is pendingDeepBid until they pick a language.
  if (session.state === 'awaiting_language' && session.pendingDeepBid) {
    return session.pendingDeepBid;
  }
  return session.businessId || null;
}

async function noteWallboardRestaurant(phone) {
  try {
    const session = await getSession(phone);
    const businessId = restaurantIdFromSession(session);
    if (!businessId) return;
    let restaurantName = null;
    try {
      const info = await getBusinessInfo(businessId);
      restaurantName = info && info.name ? info.name : null;
    } catch (_err) {
      restaurantName = null;
    }
    await updateRestaurant({
      phone,
      businessId,
      restaurantName,
    });
  } catch (_err) {
    failChat();
  }
}

module.exports = {
  viennaDayKey,
  chatKeyId,
  recordWallboardInbound,
  noteWallboardRestaurant,
  markWallboardChatOrdered,
};
