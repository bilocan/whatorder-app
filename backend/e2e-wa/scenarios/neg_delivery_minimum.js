'use strict';

const { openRestaurant, addAyranToBasket, sleep } = require('./helpers');

/**
 * Delivery below minimumOrderValue — expect gate, no place.
 * Front-load delivery via "zum Liefern" so browsing shows the min gate
 * without relying on a WA Web Confirm click (often stale/unloadable).
 * Hard: no order + gated session. Soft: minimum copy.
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[neg_delivery_minimum]', ...a);

  return session.withBusinessPatch({ minimumOrderValue: 999 }, async () => {
    await openRestaurant(session, { log });

    // Conversational slots set orderType=delivery before the item is committed;
    // showBasketForSession then renders the delivery minimum gate.
    await addAyranToBasket(session, { log, phrase: '1 ayran zum Liefern' });
    await sleep(3000);

    await session.waitForSession(
      (s) => s
        && s.orderType === 'delivery'
        && !s.deliveryAddress
        && (s.basket?.length || 0) > 0,
      { timeoutMs: 60_000 },
    ).catch(async () => {
      const cur = await session.getSession();
      throw new Error(
        `Expected delivery-min gate session, got `
        + JSON.stringify({
          state: cur?.state,
          orderType: cur?.orderType,
          address: cur?.deliveryAddress,
          basket: cur?.basket?.length,
        }),
      );
    });

    await session.waitForReply({
      includes: /mindest|minimum|€999|999|hinzu|warenkorb|below/i,
      timeoutMs: 45_000,
    }).catch((err) => {
      console.warn('[neg_delivery_minimum] min-copy soft-fail:', err.message);
    });

    log('assert no new order');
    await session.assertNoNewOrder({ timeoutMs: 45_000 });
    return { ok: true };
  });
}

module.exports = { id: 'neg_delivery_minimum', pack: 'b', run };
