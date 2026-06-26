/**
 * Post-reset smoke tests against live Firestore + order workflow.
 *
 * Usage:
 *   npm run firestore:smoke
 *   npm run firestore:smoke -- --keep-order   # leave test order in dashboard
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const { PROTECTED_BUSINESS_IDS } = require('./lib/firestoreAuditChecks');
const {
  businessRef,
  menuRef,
  ordersRef,
  customersRef,
  configRef,
} = require('../src/lib/collections');
const { db } = require('../src/lib/firebase');
const { createOrder, approveOrder } = require('../src/bot/orderService');

const PILOT_BIZ = 'biz_enes_kebap_9450w';
const SMOKE_PHONE = '+43699000999';
const keepOrder = process.argv.includes('--keep-order');

const results = [];

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function countCollection(ref) {
  const snap = await ref.get();
  return snap.size;
}

async function checkInfra() {
  console.log('\n1. Infra (post-reset baseline)');

  if (!PROTECTED_BUSINESS_IDS.has(PILOT_BIZ)) {
    fail('protected business id configured', PILOT_BIZ);
  } else {
    pass('protected business id configured', PILOT_BIZ);
  }

  const bizSnap = await businessRef(PILOT_BIZ).get();
  if (!bizSnap.exists) {
    fail('pilot business doc exists');
    return false;
  }
  const biz = bizSnap.data();
  pass('pilot business doc exists', biz.name ?? PILOT_BIZ);

  if (!biz.alertPhone) fail('pilot alertPhone set');
  else pass('pilot alertPhone set', biz.alertPhone);

  const menuCount = await countCollection(menuRef(PILOT_BIZ));
  if (menuCount === 0) fail('pilot menu not empty');
  else pass('pilot menu loaded', `${menuCount} items`);

  const routingSnap = await db.collection('phoneRouting').get();
  let routed = false;
  for (const doc of routingSnap.docs) {
    const ids = doc.data().businessIds ?? [];
    if (ids.includes(PILOT_BIZ)) {
      routed = true;
      const def = doc.data().defaultBusinessId;
      pass('pilot in phoneRouting', doc.id);
      if (def === PILOT_BIZ) pass('phoneRouting defaultBusinessId', PILOT_BIZ);
      else fail('phoneRouting defaultBusinessId', def ?? `(missing — falls back to ${ids[0]})`);
      break;
    }
  }
  if (!routed) fail('pilot in phoneRouting');

  const configSnap = await configRef().get();
  if (!configSnap.exists) fail('config/whatorder exists');
  else pass('config/whatorder exists', `${configSnap.data().feeType ?? 'fee'} configured`);

  const { isStripeConfigured } = require('../src/lib/stripe');
  if (biz.paymentEnabled === true && isStripeConfigured()) {
    pass('pilot card payment ready', 'paymentEnabled + STRIPE_SECRET_KEY');
  } else {
    fail('pilot card payment ready', `paymentEnabled=${biz.paymentEnabled ?? false} stripe=${isStripeConfigured()}`);
  }

  const ordersBefore = await countCollection(ordersRef(PILOT_BIZ));
  if (ordersBefore !== 0) fail('pilot orders empty before smoke', `${ordersBefore} orders`);
  else pass('pilot orders empty before smoke');

  const sessions = await countCollection(db.collection('sessions'));
  if (sessions !== 0) fail('sessions empty', `${sessions} sessions`);
  else pass('sessions empty');

  const ownersSnap = await db.collection('owners').limit(1).get();
  if (ownersSnap.empty) fail('at least one owner doc');
  else pass('owners collection reachable', `${await countCollection(db.collection('owners'))} owners`);

  return bizSnap.exists && menuCount > 0 && routed && configSnap.exists;
}

async function checkOrderWorkflow() {
  console.log('\n2. Order workflow (live Firestore + orderService)');

  let orderId;
  try {
    orderId = await createOrder(PILOT_BIZ, {
      customerPhone: SMOKE_PHONE,
      customerName: 'Smoke Test',
      items: [{ name: 'Smoke Test Item', qty: 1, price: 1.0 }],
      total: 1.0,
      language: 'de',
      orderType: 'pickup',
      notes: 'SMOKE_TEST — auto cleanup unless --keep-order',
      paymentMethod: 'cash',
      paymentStatus: 'cash',
    });
    pass('createOrder', orderId);
  } catch (err) {
    fail('createOrder', err.message);
    return null;
  }

  const orderSnap = await ordersRef(PILOT_BIZ).doc(orderId).get();
  if (!orderSnap.exists || orderSnap.data().status !== 'pending') {
    fail('order persisted as pending');
  } else {
    pass('order persisted as pending', orderId);
  }

  const customerId = SMOKE_PHONE.replace(/\D/g, '');
  const custSnap = await customersRef(PILOT_BIZ).doc(customerId).get();
  if (!custSnap.exists) fail('customer profile upserted');
  else pass('customer profile upserted', customerId);

  try {
    await approveOrder(PILOT_BIZ, orderId, 20);
    const approved = await ordersRef(PILOT_BIZ).doc(orderId).get();
    if (approved.data()?.status === 'approved') {
      pass('approveOrder transition', 'pending → approved');
    } else {
      fail('approveOrder transition', `status=${approved.data()?.status}`);
    }
  } catch (err) {
    fail('approveOrder transition', err.message);
  }

  return orderId;
}

async function cleanupSmokeOrder(orderId) {
  if (!orderId || keepOrder) {
    if (keepOrder && orderId) {
      console.log(`\n  kept test order ${orderId} — check dashboard`);
    }
    return;
  }

  console.log('\n3. Cleanup smoke test data');
  const customerId = SMOKE_PHONE.replace(/\D/g, '');
  await ordersRef(PILOT_BIZ).doc(orderId).delete();
  await customersRef(PILOT_BIZ).doc(customerId).delete().catch(() => {});
  const remaining = await countCollection(ordersRef(PILOT_BIZ));
  if (remaining === 0) pass('smoke order removed', 'orders back to 0');
  else fail('smoke order removed', `${remaining} orders remain`);
}

async function main() {
  console.log('Firestore smoke tests');
  console.log(`Project: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`Pilot: ${PILOT_BIZ}`);

  const infraOk = await checkInfra();
  if (!infraOk) {
    console.log('\nInfra checks failed — skipping order workflow.');
    process.exitCode = 1;
    return;
  }

  const orderId = await checkOrderWorkflow();
  await cleanupSmokeOrder(orderId);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exitCode = 1;

  console.log('\nManual checks (not automated):');
  console.log('  - Order from biz_enes_kebap_9450w (deep link or pick Enes kebap) — payment step is per-restaurant');
  console.log('  - Dashboard http://localhost:5173 — owner login, empty orders list');
  console.log('  - WhatsApp bot end-to-end (send message to pilot number)');
  console.log('  - Admin → Earnings reads config/whatorder');
}

main().catch((err) => {
  console.error('Smoke tests failed:', err);
  process.exit(1);
});
