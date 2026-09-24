/**
 * One-time backfill of wallboardFeed for the current Vienna day.
 *
 * Usage (from the app repo root):
 *   node backend/src/scripts/backfill-wallboard-feed.js
 *   DRY_RUN=1 node backend/src/scripts/backfill-wallboard-feed.js
 *
 * Skips feed documents that already exist. Does not delete anything.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });

const { admin } = require('../lib/firebase');
const {
  businessesCollectionRef,
  ordersRef,
  customersRef,
  wallboardFeedRef,
} = require('../lib/collections');
const { boardStatus } = require('../lib/wallboardFeed');

function viennaParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
}

function viennaOffsetMinutes(date) {
  const parts = viennaParts(date);
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (wall - date.getTime()) / 60000;
}

function viennaDayStart(now) {
  const parts = viennaParts(now);
  const guess = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0));
  return new Date(guess.getTime() - viennaOffsetMinutes(guess) * 60000);
}

function createdMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return 0;
}

async function main() {
  const sample = viennaDayStart(new Date('2026-09-23T10:00:00.000Z'));
  if (sample.toISOString() !== '2026-09-22T22:00:00.000Z') {
    throw new Error(`viennaDayStart drift: ${sample.toISOString()}`);
  }

  const dryRun = process.env.DRY_RUN === '1';
  const start = admin.firestore.Timestamp.fromDate(viennaDayStart(new Date()));
  const businesses = await businessesCollectionRef().get();
  let wrote = 0;

  for (const business of businesses.docs) {
    const ordersSnap = await ordersRef(business.id).where('createdAt', '>=', start).get();
    const orders = ordersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const byCustomer = new Map();
    for (const order of orders) {
      const key = order.customerPhone || order.customerId || order.id;
      if (!byCustomer.has(key)) byCustomer.set(key, []);
      byCustomer.get(key).push(order);
    }

    for (const [customerKey, list] of byCustomer) {
      list.sort((a, b) => createdMillis(a.createdAt) - createdMillis(b.createdAt) || a.id.localeCompare(b.id));
      const todayCount = list.length;
      const customerSnap = await customersRef(business.id).doc(customerKey).get();
      const orderCount = customerSnap.exists ? (Number(customerSnap.data().orderCount) || 0) : 0;

      for (let index = 0; index < list.length; index += 1) {
        const order = list[index];
        const existing = await wallboardFeedRef(order.id).get();
        if (existing.exists) continue;
        const firstOrder = index === 0 && orderCount <= todayCount;
        if (dryRun) {
          console.log(order.id);
          wrote += 1;
          continue;
        }
        await wallboardFeedRef(order.id).set({
          businessId: business.id,
          restaurantName: order.restaurantName || '',
          total: Number(order.total) || 0,
          createdAt: order.createdAt,
          boardStatus: boardStatus(order),
          paymentStatus: order.paymentStatus || '',
          orderType: order.orderType === 'delivery' || order.orderType === 'pickup' ? order.orderType : '',
          firstOrder,
        });
        wrote += 1;
      }
    }
  }

  console.log(`${dryRun ? 'would write' : 'wrote'} ${wrote}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
