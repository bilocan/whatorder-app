const { sessionRef } = require('../lib/collections');
const { db } = require('../lib/firebase');

const CHECKOUT_FIELDS = [
  'flow', 'orderType', 'deliveryAddress', 'pendingDeliveryBuilding',
  'specialRequests', 'customerName', 'pendingPaymentMethod', 'prepMins', 'pickupTime', 'confirmingOrderTypeEdit',
];
const MENU_BROWSE_FIELDS = ['textMenuIndex', 'textMenuCategory', 'menuSearchActive'];
const INTENT_FIELDS = ['pendingIntentItems', 'unmatchedIntentItems', 'intentCustomize', 'pendingItem', 'pendingIntentNote', 'pendingIntentRawText', 'intentSuggestions'];
const REORDER_FIELDS = ['pendingReorderItems', 'pendingReorderUnmatched'];
const DISAMBIGUATION_FIELDS = ['disambiguation'];
const BASKET_EDIT_FIELDS = [
  'basketRemovePending',
  'basketRemoveDisambig',
  'basketUndoSnapshot',
  'basketPendingLearning',
];
const POST_ORDER_FIELDS = ['pendingAmendOrderId', 'pendingAmendPlacedAt', 'consecutiveParseFailures'];
const MULTI_RESTAURANT_FIELDS = ['restaurantPickerUnfiltered'];

/** Firestore rejects undefined at any depth — strip before write. */
function stripUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value; // Firestore Timestamp
  if (Array.isArray(value)) return value.map(stripUndefinedDeep);
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (val === undefined) continue;
    out[key] = stripUndefinedDeep(val);
  }
  return out;
}

function buildSessionWrite(session, overrides) {
  const data = {
    state: session.state ?? 'browsing',
    language: session.language ?? null,
    businessId: session.businessId ?? null,
    basket: session.basket ?? [],
    lat: session.lat ?? null,
    lng: session.lng ?? null,
    pendingDeleteIds: session.pendingDeleteIds ?? [],
    whatsappPhoneNumberId: session.whatsappPhoneNumberId ?? null,
  };
  for (const key of [...CHECKOUT_FIELDS, ...MENU_BROWSE_FIELDS, ...INTENT_FIELDS, ...REORDER_FIELDS, ...DISAMBIGUATION_FIELDS, ...BASKET_EDIT_FIELDS, ...POST_ORDER_FIELDS, ...MULTI_RESTAURANT_FIELDS]) {
    if (session[key] != null) data[key] = session[key];
  }
  const merged = { ...data, ...overrides };
  return stripUndefinedDeep(merged);
}

async function getSession(phone) {
  const doc = await sessionRef(phone).get();
  return doc.exists ? doc.data() : { state: 'browsing', language: null, basket: [], businessId: null };
}

async function setSession(phone, data) {
  const payload = stripUndefinedDeep({ ...data, updatedAt: new Date() });
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
    transaction.set(ref, stripUndefinedDeep(payload));
  });
}

async function clearSession(phone) {
  await sessionRef(phone).delete();
}

module.exports = {
  getSession, setSession, patchSession, clearSession, buildSessionWrite, stripUndefinedDeep,
};
