'use strict';

/**
 * Shared WA Web scenario helpers (pack A/B).
 * Prefer Firestore session gates; soft-fail interactive bubble clicks.
 */

/**
 * @param {import('../lib/session').WaE2eSession} session
 * @param {string[]} titles
 * @returns {Promise<string|null>}
 */
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

/**
 * Reset customer session and bind restaurant context via ORDER+deep link.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void }} [opts]
 */
async function openRestaurant(session, opts = {}) {
  const log = opts.log || (() => {});
  log('reset customer session');
  await session.resetCustomerSession();

  log('select restaurant context');
  await session.sendText(`ORDER+${session.cfg.businessId}`);
  await session.waitForReply({
    includes: /bestell|menü|menu|döner|hallo|was möchtest|what would you like|welcome|entgegen/i,
    timeoutMs: 45_000,
  }).catch(() => {});
  await session.waitForSession(
    (s) => s?.businessId === session.cfg.businessId,
    { timeoutMs: 45_000 },
  );
  await sleep(2500);
}

/**
 * Add no-option SKU (ayran) and commit to basket. Leaves session in browsing
 * with basket length > 0 when successful.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void, phrase?: string }} [opts]
 */
async function addAyranToBasket(session, opts = {}) {
  const log = opts.log || (() => {});
  const phrase = opts.phrase || '1 ayran';

  log('place ayran phrase', phrase);
  await session.sendText(phrase);
  await session.waitForSession(
    (s) => (s?.pendingIntentItems?.length || 0) > 0 || (s?.basket?.length || 0) > 0,
    { timeoutMs: 60_000 },
  );
  await sleep(2500);

  let sess = await session.getSession();
  if ((sess?.pendingIntentItems?.length || 0) > 0) {
    const clickedAdd = await clickAny(session, ['Hinzufügen', 'Add to basket', 'Sepete ekle']);
    if (clickedAdd) log('clicked', clickedAdd);
    await sleep(3000);
    sess = await session.getSession();
    if ((sess?.pendingIntentItems?.length || 0) > 0) {
      log('proposal still pending — sending ja');
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
    throw new Error('Stuck in customizing_intent — use a no-option menu item');
  }
  if (!(sess?.basket?.length > 0)) {
    throw new Error(`Expected basket items after ayran add, got state=${sess?.state}`);
  }
  log('basket committed, len=', sess.basket.length);
  await sleep(2500);
  return sess;
}

/**
 * From browsing with basket: start checkout (Confirm/Done) toward order type / confirming.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void }} [opts]
 */
async function startCheckoutFromBasket(session, opts = {}) {
  const log = opts.log || (() => {});
  let sess = await session.getSession();
  if (sess?.state === 'browsing') {
    const clickedDone = await clickAny(session, ['Confirm', 'Bestätigen', 'Done', 'Fertig']);
    if (clickedDone) log('clicked', clickedDone);
    else {
      log('no confirm bubble — sending fertig');
      await session.sendText('fertig');
    }
    try {
      sess = await session.waitForSession(
        (s) => s && s.state !== 'browsing',
        { timeoutMs: 20_000 },
      );
    } catch (_) {
      // WA Web often reports a click but the bubble never fires — use text.
      log('still browsing after confirm click — sending fertig');
      await session.sendText('fertig');
      sess = await session.waitForSession(
        (s) => s && s.state !== 'browsing',
        { timeoutMs: 45_000 },
      );
    }
  }
  log('state after checkout start:', sess.state);
  return sess;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  clickAny,
  openRestaurant,
  addAyranToBasket,
  startCheckoutFromBasket,
  sleep,
};
