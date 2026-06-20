const { sessionRef } = require('../lib/collections');

const CHECKOUT_FIELDS = ['flow', 'orderType', 'deliveryAddress', 'specialRequests', 'customerName', 'prepMins', 'pickupTime'];

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
  for (const key of CHECKOUT_FIELDS) {
    if (session[key] != null) data[key] = session[key];
  }
  return { ...data, ...overrides };
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

async function clearSession(phone) {
  await sessionRef(phone).delete();
}

module.exports = { getSession, setSession, clearSession, buildSessionWrite };
