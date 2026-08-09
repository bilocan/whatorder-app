'use strict';

const {
  openRestaurant,
  addAyranToBasket,
  startCheckoutFromBasket,
} = require('./helpers');

/**
 * Start checkout then cancel / clear — no order placed.
 * Hard: empty basket + browsing + assertNoNewOrder.
 * Soft: cancel WhatsApp copy.
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

  log('abort checkout with clear synonym (not note)');
  // Prefer text cancel so we do not click a stale browsing "Löschen" button in chat history.
  // Product must treat "löschen" as cancel on confirming, not as specialRequests.
  await session.sendText('löschen');

  log('assert basket cleared');
  await session.waitForSession(
    (s) => s
      && s.state === 'browsing'
      && (s.basket?.length || 0) === 0,
    { timeoutMs: 45_000 },
  );

  await session.waitForReply({
    includes: /abbruch|cancel|abgebrochen|gelöscht|cleared|leer|empty|menü|bestell|warenkorb|order cancelled/i,
    timeoutMs: 45_000,
  }).catch((err) => {
    console.warn('[neg_cancel] cancel-copy soft-fail:', err.message);
  });

  log('assert no new order');
  await session.assertNoNewOrder({ timeoutMs: 45_000 });
  return { ok: true };
}

module.exports = { id: 'neg_cancel', pack: 'b', run };
