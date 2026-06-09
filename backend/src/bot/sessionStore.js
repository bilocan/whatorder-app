const { db } = require('../lib/firebase');

const col = () => db.collection('sessions');

async function getSession(phone) {
  const doc = await col().doc(phone).get();
  return doc.exists ? doc.data() : { state: 'browsing', language: null, basket: [], businessId: null };
}

async function setSession(phone, data) {
  await col().doc(phone).set({ ...data, updatedAt: new Date() });
}

async function clearSession(phone) {
  await col().doc(phone).delete();
}

module.exports = { getSession, setSession, clearSession };
