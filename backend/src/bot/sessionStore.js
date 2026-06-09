const { sessionRef } = require('../lib/collections');

async function getSession(phone) {
  const doc = await sessionRef(phone).get();
  return doc.exists ? doc.data() : { state: 'browsing', language: null, basket: [], businessId: null };
}

async function setSession(phone, data) {
  await sessionRef(phone).set({ ...data, updatedAt: new Date() });
}

async function clearSession(phone) {
  await sessionRef(phone).delete();
}

module.exports = { getSession, setSession, clearSession };
