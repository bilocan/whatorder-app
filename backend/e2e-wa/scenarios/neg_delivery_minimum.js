'use strict';

/**
 * Delivery below minimumOrderValue — expect gate, no place.
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[neg_delivery_minimum]', ...a);

  return session.withBusinessPatch({ minimumOrderValue: 999 }, async () => {
    log('minimumOrderValue=999');
    await session.sendText(`ORDER+${session.cfg.businessId}`);
    await session.waitForReply({ includes: /./, timeoutMs: 45_000 }).catch(() => {});

    await session.sendText('1 döner zum Liefern, Hauptstraße 5, bar');
    await session.waitForReply({
      includes: /mindest|minimum|€999|hinzu|warenkorb|below/i,
      timeoutMs: 60_000,
    });

    log('assert no new order');
    await session.assertNoNewOrder({ timeoutMs: 12_000 });
    return { ok: true };
  });
}

module.exports = { id: 'neg_delivery_minimum', pack: 'b', run };
