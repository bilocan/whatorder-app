'use strict';

/**
 * Start checkout then cancel / deny — no order placed.
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[neg_cancel]', ...a);

  await session.sendText(`ORDER+${session.cfg.businessId}`);
  await session.waitForReply({ includes: /./, timeoutMs: 45_000 }).catch(() => {});

  log('start order then abort');
  await session.sendText('1 döner zum Abholen, bar');
  await session.waitForReply({
    includes: /gesamt|bestätigen|prüfen|€/i,
    timeoutMs: 60_000,
  });

  await session.sendText('abbrechen');
  await session.waitForReply({
    includes: /abbruch|cancel|abgebrochen|ok|menü|bestell|warenkorb|gelöscht|cleared/i,
    timeoutMs: 45_000,
  }).catch(() => {
    // Some paths use "nein" / NO
  });

  log('assert no new order');
  await session.assertNoNewOrder({ timeoutMs: 12_000 });
  return { ok: true };
}

module.exports = { id: 'neg_cancel', pack: 'b', run };
