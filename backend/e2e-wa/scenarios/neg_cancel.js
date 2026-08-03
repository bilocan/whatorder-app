'use strict';

const {
  clickAny,
  openRestaurant,
  addAyranToBasket,
  startCheckoutFromBasket,
  sleep,
} = require('./helpers');

/**
 * Start checkout then cancel / clear — no order placed.
 * Hard: assertNoNewOrder. Soft: cancel/clear WhatsApp copy.
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[neg_cancel]', ...a);

  await openRestaurant(session, { log });
  await addAyranToBasket(session, { log, phrase: '1 ayran zum Abholen' });

  let sess = await startCheckoutFromBasket(session, { log });

  if (sess.state === 'awaiting_name') {
    log('provide name');
    await session.sendText('E2E Testkunde');
    sess = await session.waitForSession(
      (s) => s && s.state !== 'awaiting_name',
      { timeoutMs: 45_000 },
    );
  }

  log('abort checkout / clear basket');
  // Prefer clear-basket button, then text cancel paths.
  const cleared = await clickAny(session, ['Löschen', 'Clear', 'Temizle', 'Abbrechen', 'Cancel']);
  if (cleared) {
    log('clicked', cleared);
  } else {
    await session.sendText('abbrechen');
  }
  await sleep(2500);

  // If still holding a basket / mid-checkout, force clear with "alles" / nein.
  sess = await session.getSession();
  if ((sess?.basket?.length || 0) > 0 || ['confirming', 'awaiting_order_type', 'awaiting_confirmation'].includes(sess?.state)) {
    log('still mid-flow — sending nein / alles');
    await session.sendText('nein');
    await sleep(2000);
    sess = await session.getSession();
    if ((sess?.basket?.length || 0) > 0) {
      await session.sendText('alles löschen');
      await sleep(2000);
    }
  }

  await session.waitForReply({
    includes: /abbruch|cancel|abgebrochen|ok|menü|bestell|warenkorb|gelöscht|cleared|leer|empty/i,
    timeoutMs: 45_000,
  }).catch((err) => {
    console.warn('[neg_cancel] cancel-copy soft-fail:', err.message);
  });

  log('assert no new order');
  await session.assertNoNewOrder({ timeoutMs: 45_000 });
  return { ok: true };
}

module.exports = { id: 'neg_cancel', pack: 'b', run };
