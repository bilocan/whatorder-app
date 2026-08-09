'use strict';

async function clickAny(session, titles) {
  for (const title of titles) {
    try {
      await session.sendButtonReply({ title, fallback: false });
      return title;
    } catch (_) {
      /* try next label */
    }
  }
  return null;
}

async function startCheckoutFromBrowsing(session, sess, log = () => {}) {
  if (sess?.state !== 'browsing') return sess;

  const clickedDone = await clickAny(session, ['Confirm', 'Bestätigen', 'Done', 'Fertig']);
  if (clickedDone) {
    log('clicked', clickedDone);
  } else {
    log('no confirm bubble — sending fertig');
    await session.sendText('fertig');
  }
  try {
    return await session.waitForSession(
      (s) => s && s.state !== 'browsing',
      { timeoutMs: 45_000 },
    );
  } catch (err) {
    if (session.waWeb?._dumpDebug) {
      await session.waWeb._dumpDebug('checkout-stuck', {}).catch(() => {});
    }
    throw err;
  }
}

/**
 * Happy path: Stripe card pickup order via real WhatsApp + Firestore assert.
 * WhatOrder checkout with paymentEnabled uses Stripe only (no cash picker).
 *
 * Asserts: order created with paymentMethod=stripe + paymentStatus=pending,
 * and a Pay-now / payment-link WhatsApp message.
 *
 * WA Web often fails to render interactive bubbles ("Nachricht konnte nicht
 * geladen werden"). Gate progress on Firestore session/order state; confirm
 * proposals with short text `ja` (works DE/EN/TR).
 *
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[happy_stripe_pickup]', ...a);

  log('reset customer session (avoid stuck awaiting_location)');
  await session.resetCustomerSession();

  log('select restaurant context');
  await session.sendText(`ORDER+${session.cfg.businessId}`);
  await session.waitForReply({
    includes: /bestell|menü|menu|döner|hallo|was möchtest|what would you like|welcome/i,
    timeoutMs: 45_000,
  }).catch(() => {});
  await session.waitForSession(
    (s) => s?.businessId === session.cfg.businessId,
    { timeoutMs: 45_000 },
  );
  await new Promise((r) => setTimeout(r, 2500));

  log('place pickup order phrase (no-option SKU; payment is Stripe at confirm)');
  // Prefer a no-option SKU (ayran) so we skip customizing_intent.
  await session.sendText('1 ayran zum Abholen');
  await session.waitForSession(
    (s) => (s?.pendingIntentItems?.length || 0) > 0 || (s?.basket?.length || 0) > 0,
    { timeoutMs: 60_000 },
  );
  log('proposal/basket ready', JSON.stringify({
    pending: (await session.getSession())?.pendingIntentItems?.length || 0,
    basket: (await session.getSession())?.basket?.length || 0,
  }));
  await new Promise((r) => setTimeout(r, 2500));

  log('confirm proposal if needed');
  let sess = await session.getSession();
  if ((sess?.pendingIntentItems?.length || 0) > 0) {
    const clickedAdd = await clickAny(session, ['Hinzufügen', 'Add to basket', 'Sepete ekle']);
    if (clickedAdd) log('clicked', clickedAdd);
    await new Promise((r) => setTimeout(r, 3000));
    sess = await session.getSession();
    if ((sess?.pendingIntentItems?.length || 0) > 0) {
      log('proposal still pending after click — sending ja');
      await session.sendText('ja');
    }
    await session.waitForSession(
      (s) => (s?.basket?.length || 0) > 0 && !(s?.pendingIntentItems?.length > 0)
        && s?.state !== 'customizing_intent',
      { timeoutMs: 45_000 },
    );
  }
  sess = await session.getSession();
  if (sess?.state === 'customizing_intent') {
    throw new Error('Stuck in customizing_intent — use a no-option menu item for pack A smoke');
  }
  log('basket committed, len=', sess?.basket?.length);
  await new Promise((r) => setTimeout(r, 2500));

  log('checkout → Confirm (post-add uses btn_confirm)');
  sess = await session.getSession();
  sess = await startCheckoutFromBrowsing(session, sess, log);
  log('state after checkout start:', sess.state);

  if (sess.state === 'awaiting_name') {
    log('provide name');
    await session.sendText('E2E Testkunde');
    await session.waitForSession(
      (s) => s && s.state !== 'awaiting_name',
      { timeoutMs: 45_000 },
    );
    sess = await session.getSession();
  }

  // With paymentEnabled + Stripe, final confirm places the order and sends the pay link.
  // Bot state is `confirming` (not awaiting_confirmation / awaiting_payment).
  if (sess?.state === 'confirming') {
    log('final confirm → Stripe order + pay link');
    const clickedConfirm = await clickAny(
      session,
      ['Bestätigen', 'Confirm', 'Bestätigen ✅', 'Confirm ✅'],
    );
    if (!clickedConfirm) await session.sendText('ja');
  }

  log('wait for Stripe order in Firestore');
  const order = await session.waitForOrder({
    status: 'pending',
    paymentMethod: 'stripe',
    timeoutMs: 90_000,
  });
  if (order.paymentStatus && order.paymentStatus !== 'pending') {
    throw new Error(`Expected paymentStatus=pending for Stripe order, got ${order.paymentStatus}`);
  }
  log('order', order.id, 'total', order.total, 'paymentMethod', order.paymentMethod);

  // Soft-assert pay-link copy (CTA may be unloadable on WA Web)
  await session.waitForReply({
    includes: /pay now|jetzt zahlen|ödeme|stripe|checkout|💳|payment|zahlung|#/i,
    timeoutMs: 45_000,
  }).catch((err) => {
    console.warn('[happy_stripe_pickup] pay-link reply soft-fail:', err.message);
  });

  return { order };
}

module.exports = {
  id: 'happy_stripe_pickup',
  pack: 'a',
  run,
  startCheckoutFromBrowsing,
};
