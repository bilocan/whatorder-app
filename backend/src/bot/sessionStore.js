const { sessionRef } = require('../lib/collections');
const { db } = require('../lib/firebase');

const CHECKOUT_FIELDS = ['flow', 'orderType', 'deliveryAddress', 'specialRequests', 'customerName', 'prepMins', 'pickupTime'];
const MENU_BROWSE_FIELDS = ['textMenuIndex', 'textMenuCategory'];
const INTENT_FIELDS = ['pendingIntentItems', 'unmatchedIntentItems', 'intentCustomize', 'pendingItem'];
const REORDER_FIELDS = ['pendingReorderItems', 'pendingReorderUnmatched'];

function buildSessionWrite(session, overrides) {
  const data = {
    state: session.state ?? 'browsing',
    language: session.language ?? null,
    businessId: session.businessId ?? null,
    basket: session.basket ?? [],
    lat: session.lat ?? null,
    lng: session.lng ?? null,
    pendingDeleteIds: session.pendingDeleteIds ?? [],
  };
  for (const key of [...CHECKOUT_FIELDS, ...MENU_BROWSE_FIELDS, ...INTENT_FIELDS, ...REORDER_FIELDS]) {
    if (session[key] != null) data[key] = session[key];
  }
  const merged = { ...data, ...overrides };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}

async function getSession(phone) {
  const doc = await sessionRef(phone).get();
  return doc.exists ? doc.data() : { state: 'browsing', language: null, basket: [], businessId: null };
}

async function setSession(phone, data) {
  const payload = { ...data, updatedAt: new Date() };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  await sessionRef(phone).set(payload);
}

const DEFAULT_SESSION = { state: 'browsing', language: null, basket: [], businessId: null };

// Atomic read-modify-write. Required after any await that sends WhatsApp messages —
// concurrent handlers (e.g. openCategoryMenu menuId patch vs number-select confirm) must
// not clobber pendingIntentItems or basket with a stale snapshot.
async function patchSession(phone, overrides = {}, _baseSession = null) {
  const ref = sessionRef(phone);
  const payloadOverrides = { ...overrides };
  if ('menuId' in payloadOverrides) {
    payloadOverrides.pendingDeleteIds = payloadOverrides.menuId ? [payloadOverrides.menuId] : [];
    delete payloadOverrides.menuId;
  }

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    const live = doc.exists ? doc.data() : DEFAULT_SESSION;
    const payload = buildSessionWrite(live, payloadOverrides);
    payload.updatedAt = new Date();
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    transaction.set(ref, payload);
  });
}

async function clearSession(phone) {
  await sessionRef(phone).delete();
}

module.exports = { getSession, setSession, patchSession, clearSession, buildSessionWrite };
