const { db, admin } = require('./firebase');
const { businessRef, payoutsRef } = require('./collections');
const { getSettlementConfig, resolveConnectMode } = require('./settlementConfig');
const { executeConnectTransfer } = require('./connectTransfer');

async function fetchEligibleOrders(batchRunTimeIso, { ignoreHold }) {
  let query = db.collectionGroup('orders').where('settlementStatus', '==', 'pending');
  if (!ignoreHold) {
    query = query.where('settlementEligibleAt', '<=', batchRunTimeIso);
  }
  const snap = await query.get();

  const byBusiness = new Map();
  for (const doc of snap.docs) {
    const businessId = doc.ref.parent.parent?.id;
    if (!businessId) continue;
    if (!byBusiness.has(businessId)) byBusiness.set(businessId, []);
    byBusiness.get(businessId).push(doc);
  }
  return byBusiness;
}

async function countHoldBlockedOrders(batchRunTimeIso) {
  const snap = await db.collectionGroup('orders')
    .where('settlementStatus', '==', 'pending')
    .where('settlementEligibleAt', '>', batchRunTimeIso)
    .get();
  return snap.size;
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

module.exports = { runPayoutBatch, fetchEligibleOrders, countHoldBlockedOrders };
