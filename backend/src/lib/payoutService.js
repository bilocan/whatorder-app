const { db, admin } = require('./firebase');
const { businessRef, ordersRef, payoutsRef } = require('./collections');
const { getSettlementConfig, resolveConnectMode } = require('./settlementConfig');
const { executeConnectTransfer } = require('./connectTransfer');

function isMissingIndexError(err) {
  const code = err?.code;
  const msg = err?.message ?? '';
  return code === 9 || /requires an index|COLLECTION_GROUP/i.test(msg);
}

function filterEligibleDocs(docs, batchRunTimeIso, ignoreHold) {
  return docs.filter((doc) => {
    if (ignoreHold) return true;
    const at = doc.data().settlementEligibleAt;
    return typeof at === 'string' && at <= batchRunTimeIso;
  });
}

/** Per-business scan — no collectionGroup index required (pilot scale). */
async function fetchEligibleOrdersPerBusiness(batchRunTimeIso, { ignoreHold }) {
  const bizSnap = await db.collection('businesses').get();
  const byBusiness = new Map();

  await Promise.all(bizSnap.docs.map(async (bizDoc) => {
    const businessId = bizDoc.id;
    const snap = await ordersRef(businessId).where('settlementStatus', '==', 'pending').get();
    const docs = filterEligibleDocs(snap.docs, batchRunTimeIso, ignoreHold);
    if (docs.length) byBusiness.set(businessId, docs);
  }));

  return byBusiness;
}

/** Upper bound when mock skips hold — keeps query on the composite collectionGroup index. */
const HOLD_IGNORED_CUTOFF = '9999-12-31T23:59:59.999Z';

async function fetchEligibleOrdersCollectionGroup(batchRunTimeIso, { ignoreHold }) {
  const holdCutoff = ignoreHold ? HOLD_IGNORED_CUTOFF : batchRunTimeIso;
  const snap = await db.collectionGroup('orders')
    .where('settlementStatus', '==', 'pending')
    .where('settlementEligibleAt', '<=', holdCutoff)
    .get();

  const byBusiness = new Map();
  for (const doc of snap.docs) {
    const businessId = doc.ref.parent.parent?.id;
    if (!businessId) continue;
    if (!byBusiness.has(businessId)) byBusiness.set(businessId, []);
    byBusiness.get(businessId).push(doc);
  }
  return byBusiness;
}

async function fetchEligibleOrders(batchRunTimeIso, { ignoreHold }) {
  try {
    return await fetchEligibleOrdersCollectionGroup(batchRunTimeIso, { ignoreHold });
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    console.warn('[payout] collectionGroup index missing — deploy firestore:indexes; using per-business scan');
    return fetchEligibleOrdersPerBusiness(batchRunTimeIso, { ignoreHold });
  }
}

async function countHoldBlockedOrders(batchRunTimeIso) {
  try {
    const snap = await db.collectionGroup('orders')
      .where('settlementStatus', '==', 'pending')
      .where('settlementEligibleAt', '>', batchRunTimeIso)
      .get();
    return snap.size;
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
  }

  const bizSnap = await db.collection('businesses').get();
  let count = 0;
  await Promise.all(bizSnap.docs.map(async (bizDoc) => {
    const snap = await ordersRef(bizDoc.id).where('settlementStatus', '==', 'pending').get();
    count += snap.docs.filter((doc) => {
      const at = doc.data().settlementEligibleAt;
      return typeof at === 'string' && at > batchRunTimeIso;
    }).length;
  }));
  return count;
}

async function runPayoutBatch({ batchRunTime = new Date(), dryRun = false } = {}) {
  const runAt = batchRunTime instanceof Date ? batchRunTime : new Date(batchRunTime);
  const batchRunTimeIso = runAt.toISOString();
  const config = await getSettlementConfig();
  const connectMode = resolveConnectMode(config);
  const ignoreHold = connectMode === 'mock' && config.mockIgnoreHold;

  const byBusiness = await fetchEligibleOrders(batchRunTimeIso, { ignoreHold });
  const payouts = [];
  let eligibleOrderCount = 0;

  for (const [businessId, orderDocs] of byBusiness) {
    eligibleOrderCount += orderDocs.length;
    const totalNetCents = orderDocs.reduce(
      (sum, doc) => sum + (doc.data().restaurantNetCents ?? 0),
      0,
    );
    const whatorderFeeCentsTotal = orderDocs.reduce(
      (sum, doc) => sum + (doc.data().whatorderFeeCents ?? 0),
      0,
    );
    const orderIds = orderDocs.map((d) => d.id);

    if (totalNetCents < config.minimumPayoutCents) {
      payouts.push({
        businessId,
        status: 'skipped_below_minimum',
        orderCount: orderIds.length,
        totalNetCents,
        minimumPayoutCents: config.minimumPayoutCents,
      });
      continue;
    }

    const bizSnap = await businessRef(businessId).get();
    const business = bizSnap.exists ? { id: businessId, ...bizSnap.data() } : { id: businessId };

    const payoutRef = payoutsRef().doc();
    const payoutId = payoutRef.id;

    let transfer;
    try {
      transfer = await executeConnectTransfer({
        businessId,
        business,
        amountCents: totalNetCents,
        config,
        payoutId,
      });
    } catch (err) {
      if (err.code === 'CONNECT_NOT_READY') {
        payouts.push({
          businessId,
          status: 'skipped_connect_not_ready',
          orderCount: orderIds.length,
          totalNetCents,
          connectMode,
        });
        continue;
      }
      throw err;
    }

    if (dryRun) {
      payouts.push({
        businessId,
        status: 'dry_run',
        payoutId,
        orderCount: orderIds.length,
        orderIds,
        totalNetCents,
        whatorderFeeCentsTotal,
        connectMode: transfer.mode,
        stripeTransferId: transfer.transferId,
        connectAccountId: transfer.connectAccountId,
      });
      continue;
    }

    await payoutRef.set({
      businessId,
      orderIds,
      totalNetCents,
      whatorderFeeCentsTotal,
      status: 'paid',
      connectMode: transfer.mode,
      stripeTransferId: transfer.transferId,
      stripeConnectAccountId: transfer.connectAccountId,
      paidAt: batchRunTimeIso,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const batch = db.batch();
    for (const orderDoc of orderDocs) {
      batch.update(orderDoc.ref, {
        settlementStatus: 'paid_out',
        paidAt: batchRunTimeIso,
        payoutId,
        stripeTransferId: transfer.transferId,
      });
    }
    await batch.commit();

    payouts.push({
      businessId,
      status: 'paid',
      payoutId,
      orderCount: orderIds.length,
      totalNetCents,
      connectMode: transfer.mode,
      stripeTransferId: transfer.transferId,
    });
  }

  const holdBlockedCount = ignoreHold ? 0 : await countHoldBlockedOrders(batchRunTimeIso);

  return {
    batchRunTime: batchRunTimeIso,
    dryRun,
    connectMode,
    ignoreHold,
    eligibleBusinesses: byBusiness.size,
    eligibleOrderCount,
    holdBlockedCount,
    summary: {
      batchesPaid: payouts.filter((p) => p.status === 'paid' || p.status === 'dry_run').length,
      skippedBelowMinimum: payouts.filter((p) => p.status === 'skipped_below_minimum').length,
      skippedConnect: payouts.filter((p) => p.status === 'skipped_connect_not_ready').length,
    },
    payouts,
  };
}

module.exports = {
  runPayoutBatch,
  fetchEligibleOrders,
  fetchEligibleOrdersPerBusiness,
  countHoldBlockedOrders,
};
