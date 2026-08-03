'use strict';

const { sleep } = require('./helpers');

/**
 * Restaurant not accepting orders (ordersOpen=false).
 * Hard: no new Firestore order. Soft: closed WhatsApp copy.
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[neg_closed]', ...a);

  return session.withBusinessPatch({ ordersOpen: false }, async () => {
    log('reset customer session');
    await session.resetCustomerSession();

    log('ordersOpen=false; ORDER+ deep link should refuse');
    await session.sendText(`ORDER+${session.cfg.businessId}`);

    await session.waitForReply({
      includes: /geschlossen|closed|nicht|pause|online|bestellungen|accepting|vorübergehend|entgegen|sipariş almıyor/i,
      timeoutMs: 60_000,
    }).catch((err) => {
      console.warn('[neg_closed] closed-copy soft-fail:', err.message);
    });

    // enterRestaurantDirect still binds businessId when paused (see botHandler).
    await session.waitForSession(
      (s) => s?.businessId === session.cfg.businessId,
      { timeoutMs: 45_000 },
    );

    log('second order attempt while paused');
    await session.sendText('1 ayran zum Abholen');
    await sleep(5000);

    await session.waitForReply({
      includes: /geschlossen|closed|nicht|pause|bestellungen|accepting|entgegen|sipariş almıyor/i,
      timeoutMs: 30_000,
    }).catch(() => {});

    log('assert no new order');
    await session.assertNoNewOrder({ timeoutMs: 45_000 });
    return { ok: true };
  });
}

module.exports = { id: 'neg_closed', pack: 'b', run };
