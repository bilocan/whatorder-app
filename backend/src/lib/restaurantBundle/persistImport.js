const { admin, db } = require('../firebase');
const { deserializeValue } = require('./serialize');
const { uploadAssets } = require('./assets');
const {
  businessRef, menuRef, optionGroupsRef, dealsRef, intentLearningsRef,
  seededIntentsRef, seedOverridesRef, ordersRef, customersRef, receiptsRef,
  receiptCounterRef, phoneRoutingRef, ownerRef,
} = require('../collections');

const BATCH_SIZE = 400;

const COL_REFS = {
  menu: menuRef,
  optionGroups: optionGroupsRef,
  deals: dealsRef,
  intentLearnings: intentLearningsRef,
  seededIntents: seededIntentsRef,
  orders: ordersRef,
  customers: customersRef,
  receipts: receiptsRef,
};

async function deleteAll(colRef) {
  while (true) {
    const snap = await colRef.limit(BATCH_SIZE).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_SIZE) return;
  }
}

function prepared(data) {
  return deserializeValue(data, admin.firestore.Timestamp);
}

async function writeMap(colRef, docs) {
  const entries = Object.entries(docs || {});
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const [id, data] of entries.slice(i, i + BATCH_SIZE)) {
      batch.set(colRef.doc(id), prepared(data));
    }
    await batch.commit();
  }
}

function normalizePhone(raw) {
  const stripped = String(raw || '').replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

async function linkOwner(phone, businessId) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 4) return;
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByPhoneNumber(normalized);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    userRecord = await admin.auth().createUser({ phoneNumber: normalized });
  }
  await ownerRef(userRecord.uid).set(
    {
      businessId,
      phone: normalized,
      businessIds: admin.firestore.FieldValue.arrayUnion(businessId),
    },
    { merge: true },
  );
}

async function persistImport(result, {
  profile, overwrite, attachToPhoneLine, targetPhoneNumberId,
  assets = [], sourceBusinessId,
}) {
  const businessId = result.targetBusinessId;
  if (overwrite) {
    for (const name of ['menu', 'optionGroups', 'deals', 'intentLearnings', 'seededIntents']) {
      await deleteAll(COL_REFS[name](businessId));
    }
    await seedOverridesRef(businessId).delete().catch(() => {});
    if (profile === 'full') {
      for (const name of ['orders', 'customers', 'receipts']) {
        await deleteAll(COL_REFS[name](businessId));
      }
    }
  }

  await uploadAssets(assets, {
    sourceBusinessId: sourceBusinessId || result.business?.id,
    targetBusinessId: businessId,
  });

  await businessRef(businessId).set(prepared(result.business), { merge: false });

  await writeMap(menuRef(businessId), result.menu);
  await writeMap(optionGroupsRef(businessId), result.optionGroups);
  await writeMap(dealsRef(businessId), result.deals);
  await writeMap(intentLearningsRef(businessId), result.intentLearnings);
  await writeMap(seededIntentsRef(businessId), result.seededIntents);
  if (result.seedOverrides) {
    await seedOverridesRef(businessId).set(prepared(result.seedOverrides));
  }

  if (profile === 'full') {
    await writeMap(ordersRef(businessId), result.orders);
    await writeMap(customersRef(businessId), result.customers);
    await writeMap(receiptsRef(businessId), result.receipts);
    if (result.receiptCounter) {
      await receiptCounterRef(businessId).set(prepared(result.receiptCounter));
    }
  }

  for (const owner of result.owners || []) {
    await linkOwner(owner.phone, businessId);
  }

  if (attachToPhoneLine && targetPhoneNumberId) {
    await phoneRoutingRef(targetPhoneNumberId).set(
      { businessIds: admin.firestore.FieldValue.arrayUnion(businessId) },
      { merge: true },
    );
  }
}

module.exports = { persistImport, deleteAll, BATCH_SIZE };
