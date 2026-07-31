'use strict';

/**
 * Happy path: cash pickup order via real WhatsApp + Firestore assert.
 * Phrases aligned with manual-test-conversational-m1-m2 (DE / Enes).
 *
 * @param {import('../lib/session').WaE2eSession} session
 */
async function run(session) {
  const log = (...a) => console.log('[happy_cash_pickup]', ...a);

  // Deep-link style / greeting to anchor restaurant context when multi-tenant
  log('select restaurant context');
  await session.sendText(`ORDER+${session.cfg.businessId}`);
  await session.waitForReply({
    includes: /bestell|menü|menu|döner|hallo|was möchtest/i,
    timeoutMs: 45_000,
  }).catch(() => {
    // Some tenants reply with picker copy — continue with order phrase
  });

  log('place cash pickup order phrase');
  // "bar zahlen" (not bare "bar") — bare bar was matched as a menu item.
  await session.sendText('1 döner zum Abholen, bar zahlen');
  await session.waitForReply({
    includes: /gesamt|bestätigen|prüfen|fertig|€/i,
    timeoutMs: 60_000,
  });

  log('confirm');
  await session.sendText('Bestätigen');
  // Bot may ask name first for new customers
  const afterConfirm = await session.waitForReply({
    includes: /name|bestätigt|bestellung|danke|order|#|€|angenommen|pending|unterwegs|cash|bar/i,
    timeoutMs: 60_000,
  });

  if (/name|heiße|wie lautet/i.test(afterConfirm.text)) {
    log('provide name');
    await session.sendText('E2E Testkunde');
    await session.waitForReply({
      includes: /bestätigen|prüfen|gesamt|€/i,
      timeoutMs: 45_000,
    });
    await session.sendText('Bestätigen');
    await session.waitForReply({
      includes: /bestätigt|danke|order|#|angenommen|bar|cash|€/i,
      timeoutMs: 60_000,
    });
  }

  log('wait for Firestore order');
  const order = await session.waitForOrder({ status: 'pending', timeoutMs: 90_000 });
  log('order', order.id, 'total', order.total);
  return { order };
}

module.exports = { id: 'happy_cash_pickup', pack: 'a', run };
