'use strict';

/**
 * Restaurant not accepting orders (ordersOpen=false).
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[neg_closed]', ...a);

  return session.withBusinessPatch({ ordersOpen: false }, async () => {
    log('ordersOpen=false; send order attempt');
    await session.sendText(`ORDER+${session.cfg.businessId}`);
    await session.waitForReply({ includes: /./, timeoutMs: 45_000 }).catch(() => {});

    await session.sendText('1 döner zum Abholen, bar');
    await session.waitForReply({
      includes: /geschlossen|closed|nicht|pause|online|bestellungen|accepting|vorübergehend/i,
      timeoutMs: 60_000,
    });

    log('assert no new order');
    await session.assertNoNewOrder({ timeoutMs: 12_000 });
    return { ok: true };
  });
}

module.exports = { id: 'neg_closed', pack: 'b', run };
