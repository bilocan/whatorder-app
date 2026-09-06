const { serializeValue } = require('./serialize');
const {
  businessRef, menuRef, optionGroupsRef, dealsRef, intentLearningsRef,
  seededIntentsRef, seedOverridesRef, ordersRef, customersRef, receiptsRef,
  receiptCounterRef, ownersByBusinessIdsQuery, ownersByLegacyBusinessIdQuery,
} = require('../collections');

const SETUP_COLS = [
  ['menu', menuRef],
  ['optionGroups', optionGroupsRef],
  ['deals', dealsRef],
  ['intentLearnings', intentLearningsRef],
  ['seededIntents', seededIntentsRef],
];

const FULL_COLS = [
  ['orders', ordersRef],
  ['customers', customersRef],
  ['receipts', receiptsRef],
];

async function listDocs(colRef) {
  const snap = await colRef.get();
  const out = {};
  snap.forEach((doc) => {
    out[doc.id] = serializeValue(doc.data() || {});
  });
  return out;
}

async function loadOwners(businessId) {
  const [byArray, byLegacy] = await Promise.all([
    ownersByBusinessIdsQuery(businessId).get(),
    ownersByLegacyBusinessIdQuery(businessId).get(),
  ]);
  const seen = new Set();
  const owners = [];
  for (const snap of [byArray, byLegacy]) {
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (!data.phone || seen.has(data.phone)) return;
      seen.add(data.phone);
      owners.push({ phone: data.phone, name: data.name || null });
    });
  }
  return owners;
}

async function loadTenant(businessId, profile) {
  const bizSnap = await businessRef(businessId).get();
  if (!bizSnap.exists) {
    const err = new Error('Restaurant not found');
    err.status = 404;
    throw err;
  }
  const firestore = {
    business: { id: businessId, ...serializeValue(bizSnap.data() || {}) },
    seedOverrides: null,
    owners: await loadOwners(businessId),
  };
  for (const [name, refFn] of SETUP_COLS) {
    firestore[name] = await listDocs(refFn(businessId));
  }
  const seedSnap = await seedOverridesRef(businessId).get();
  if (seedSnap.exists) firestore.seedOverrides = serializeValue(seedSnap.data() || {});

  if (profile === 'full') {
    for (const [name, refFn] of FULL_COLS) {
      firestore[name] = await listDocs(refFn(businessId));
    }
    const counterSnap = await receiptCounterRef(businessId).get();
    firestore.receiptCounter = counterSnap.exists
      ? serializeValue(counterSnap.data() || {})
      : null;
  }

  return firestore;
}

module.exports = { loadTenant, loadOwners, SETUP_COLS, FULL_COLS };
