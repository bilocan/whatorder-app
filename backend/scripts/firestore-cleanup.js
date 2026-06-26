/**
 * Delete transactional / ephemeral Firestore data. Keeps restaurants, menus,
 * routing, owners, config, and intentLearnings intact.
 *
 * Usage:
 *   npm run firestore:cleanup -- --dry-run --mode=reset
 *   npm run firestore:cleanup -- --mode=reset --confirm
 *   npm run firestore:cleanup -- --dry-run --mode=retention --orders-older-than=7d
 *   npm run firestore:cleanup -- --dry-run --business biz_enes_kebap_9450w
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const { db } = require('../src/lib/firebase');
const {
  ordersRef,
  customersRef,
} = require('../src/lib/collections');
const { PROTECTED_BUSINESS_IDS } = require('./lib/firestoreAuditChecks');
const {
  parseCleanupArgs,
  shouldDeleteOrder,
  shouldDeleteSession,
  shouldDeleteEphemeral,
  resolveBusinessIds,
} = require('./lib/firestoreCleanupLib');

const BATCH_SIZE = 400;

/** @param {FirebaseFirestore.CollectionReference} ref */
async function listSnapshotDocs(ref) {
  const snap = await ref.get();
  return snap.docs;
}

/**
 * @param {FirebaseFirestore.DocumentSnapshot[]} docs
 * @param {boolean} dryRun
 */
async function deleteDocSnapshots(docs, dryRun) {
  if (!docs.length) return 0;

  if (dryRun) return docs.length;

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

/**
 * @param {string} businessId
 * @param {ReturnType<typeof parseCleanupArgs>} opts
 */
async function cleanupBusiness(businessId, opts) {
  const orderDocs = await listSnapshotDocs(ordersRef(businessId));
  const ordersToDelete = orderDocs.filter((doc) =>
    shouldDeleteOrder(opts.mode, opts.cutoffs.orders, doc.data()),
  );

  const customerDocs = await listSnapshotDocs(customersRef(businessId));
  let customersToDelete = customerDocs;

  if (opts.mode === 'retention') {
    const remainingOrderPhones = new Set();
    for (const doc of orderDocs) {
      if (ordersToDelete.includes(doc)) continue;
      const data = doc.data();
      const phone = String(data.customerId ?? data.customerPhone ?? '').replace(/\D/g, '');
      if (phone) remainingOrderPhones.add(phone);
    }
    customersToDelete = customerDocs.filter((doc) => {
      const phone = String(doc.id || doc.data().phone || '').replace(/\D/g, '');
      return !remainingOrderPhones.has(phone);
    });
  }

  const deletedOrders = await deleteDocSnapshots(ordersToDelete, opts.dryRun);
  const deletedCustomers = await deleteDocSnapshots(customersToDelete, opts.dryRun);

  return {
    businessId,
    protected: PROTECTED_BUSINESS_IDS.has(businessId),
    orders: { matched: ordersToDelete.length, total: orderDocs.length },
    customers: { matched: customersToDelete.length, total: customerDocs.length },
    deletedOrders,
    deletedCustomers,
  };
}

/** @param {ReturnType<typeof parseCleanupArgs>} opts */
async function cleanupTopLevel(opts) {
  const sessionDocs = await listSnapshotDocs(db.collection('sessions'));
  const sessionsToDelete = sessionDocs.filter((doc) =>
    shouldDeleteSession(opts.mode, opts.cutoffs.sessions, doc.data()),
  );

  const processedDocs = await listSnapshotDocs(db.collection('processedMessages'));
  const processedToDelete = processedDocs.filter((doc) =>
    shouldDeleteEphemeral(opts.mode, opts.cutoffs.processedMessages, doc.data(), 'processedAt'),
  );

  const stripeDocs = await listSnapshotDocs(db.collection('stripeEvents'));
  const stripeToDelete = stripeDocs.filter((doc) =>
    shouldDeleteEphemeral(opts.mode, opts.cutoffs.stripeEvents, doc.data(), 'processedAt'),
  );

  const deletedSessions = await deleteDocSnapshots(sessionsToDelete, opts.dryRun);
  const deletedProcessedMessages = await deleteDocSnapshots(processedToDelete, opts.dryRun);
  const deletedStripeEvents = await deleteDocSnapshots(stripeToDelete, opts.dryRun);

  return {
    sessions: { matched: sessionsToDelete.length, total: sessionDocs.length, deleted: deletedSessions },
    processedMessages: {
      matched: processedToDelete.length,
      total: processedDocs.length,
      deleted: deletedProcessedMessages,
    },
    stripeEvents: {
      matched: stripeToDelete.length,
      total: stripeDocs.length,
      deleted: deletedStripeEvents,
    },
  };
}

/** @param {object} report */
function printReport(report) {
  const prefix = report.dryRun ? '[dry-run] ' : '';
  console.log(`${prefix}Firestore cleanup\n`);
  console.log(`Project: ${report.project ?? '(unknown)'}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Protected business IDs (infra kept): ${[...PROTECTED_BUSINESS_IDS].join(', ')}\n`);

  console.log('Per business (orders + customers only; menu + intentLearnings untouched)');
  for (const b of report.perBusiness) {
    const tag = b.protected ? ' [protected infra]' : '';
    console.log(
      `  ${b.businessId}${tag}: orders ${b.deletedOrders}/${b.orders.total}, customers ${b.deletedCustomers}/${b.customers.total}`,
    );
  }

  console.log('\nTop-level ephemeral');
  console.log(
    `  sessions: ${report.topLevel.sessions.deleted}/${report.topLevel.sessions.total}`,
  );
  console.log(
    `  processedMessages: ${report.topLevel.processedMessages.deleted}/${report.topLevel.processedMessages.total}`,
  );
  console.log(
    `  stripeEvents: ${report.topLevel.stripeEvents.deleted}/${report.topLevel.stripeEvents.total}`,
  );

  console.log('\nNever touched: businesses/*, menu, intentLearnings, phoneRouting, owners, admins, config/whatorder');

  if (report.dryRun) {
    console.log('\nRe-run with --confirm to apply deletes.');
  } else {
    console.log('\nDone. Run npm run firestore:audit to verify.');
  }
}

async function runCleanup() {
  const opts = parseCleanupArgs(process.argv.slice(2));

  if (!opts.dryRun && !opts.confirm) {
    console.error('Refusing to delete without --confirm. Preview with --dry-run first.');
    process.exit(1);
  }

  const businessSnap = await db.collection('businesses').get();
  const allBusinessIds = businessSnap.docs.map((d) => d.id);
  const businessIds = resolveBusinessIds(allBusinessIds, opts.businessId);

  const perBusiness = [];
  for (const businessId of businessIds) {
    perBusiness.push(await cleanupBusiness(businessId, opts));
  }

  const topLevel = await cleanupTopLevel(opts);

  const report = {
    dryRun: opts.dryRun,
    mode: opts.mode,
    project: process.env.FIREBASE_PROJECT_ID ?? null,
    perBusiness,
    topLevel,
  };

  printReport(report);
  return report;
}

runCleanup().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
