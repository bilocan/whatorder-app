'use strict';

/**
 * Owner status path after happy_stripe_pickup (or an existing orderId).
 * Marks Stripe payment paid via Admin SDK first, then approve → preparing → ready.
 *
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ orderId?: string }} [opts]
 */
async function run(session, opts = {}) {
  const log = (...a) => console.log('[owner_status_path]', ...a);
  const orderId = opts.orderId || session.lastOrder?.id;
  if (!orderId) {
    throw new Error('owner_status_path requires orderId or session.lastOrder from happy_stripe_pickup');
  }

  log('mark paid (Admin SDK)', orderId);
  await session.markOrderPaid(orderId);

  log('approve', orderId);
  await session.ownerApprove(orderId, { etaMinutes: 20 });
  await session.waitForOrderStatus(orderId, 'approved');
  await session.waitForReply({
    includes: /genehmigt|approved|angenommen|vorbereitet|eta|min/i,
    timeoutMs: 60_000,
  }).catch((err) => {
    console.warn('[owner_status_path] approve reply soft-fail:', err.message);
  });

  log('preparing');
  await session.ownerStartPreparation(orderId);
  await session.waitForOrderStatus(orderId, 'preparing');
  await session.waitForReply({
    includes: /zubereitung|preparing|wird zubereitet|hazırlanıyor/i,
    timeoutMs: 60_000,
  }).catch((err) => {
    console.warn('[owner_status_path] preparing reply soft-fail:', err.message);
  });

  log('ready');
  await session.ownerMarkReady(orderId);
  await session.waitForOrderStatus(orderId, 'ready');
  await session.waitForReply({
    includes: /bereit|ready|abhol|fertig|hazır/i,
    timeoutMs: 60_000,
  }).catch((err) => {
    console.warn('[owner_status_path] ready reply soft-fail:', err.message);
  });

  log('done', orderId);
  return { orderId };
}

module.exports = { id: 'owner_status_path', pack: 'a', run };
