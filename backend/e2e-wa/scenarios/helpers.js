'use strict';

const DELIVERY_PHRASE = '1 döner und 1 ayran zum Liefern, Hauptstraße 5';
const DELIVERY_PHRASE_NO_ADDRESS = '1 döner und 1 ayran zum Liefern';
const ADDRESS_SHORTCIRCUIT = 'Hauptstraße 5, 1030 Wien, Top 1';

/**
 * Discovery fallback for the Enes tenant. Firestore normally persists the
 * menu-shaped optionGroups in intentCustomize.queue; this keeps the Pack A
 * delivery flow deterministic if that snapshot is thin.
 */
const E2E_DONER_GROUPS = [{
  id: 'kebap_beilagen',
  label: 'Kebap Beilagen',
  type: 'multi',
  required: false,
  options: [
    { id: 'tomaten', label: 'Tomaten' },
    { id: 'salad', label: 'Salad' },
    { id: 'zwiebel', label: 'Zwiebel' },
    { id: 'sauce', label: 'Sauce' },
  ],
}];

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

function currentCustomizeGroup(sess) {
  const customize = sess?.intentCustomize;
  const groupIdx = customize?.groupIdx ?? 0;
  const queuedGroups = customize?.queue?.[0]?.optionGroups;
  return queuedGroups?.[groupIdx] || E2E_DONER_GROUPS[groupIdx];
}

function customizationPosition(sess) {
  const customize = sess?.intentCustomize;
  return [
    customize?.queue?.[0]?.menuItemId || customize?.queue?.[0]?.name || '',
    customize?.queue?.length ?? 0,
    customize?.groupIdx ?? 0,
    customize?.unitMode ?? '',
    customize?.unitIndex ?? 0,
  ].join('|');
}

/**
 * Complete all currently queued intent option groups using the interaction
 * protocol emitted by intentCustomize.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void, timeoutMs?: number }} [opts]
 */
async function completeCustomizing(session, opts = {}) {
  const log = opts.log || (() => {});
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  let sess = await session.getSession();

  while (sess?.state === 'customizing_intent') {
    const group = currentCustomizeGroup(sess);
    if (!group) {
      throw new Error('Cannot determine current intent customization group');
    }

    const before = customizationPosition(sess);
    const currentItem = sess?.intentCustomize?.queue?.[0];
    if ((currentItem?.qty || 0) > 1 && sess?.intentCustomize?.unitMode == null) {
      const clicked = await clickAny(session, ['Alle gleich', 'Same for all']);
      if (clicked) {
        log('clicked same-for-all customization', clicked);
      } else {
        log('no same-for-all bubble, sending Alle gleich');
        await session.sendText('Alle gleich');
      }
    } else if (group.type === 'multi') {
      const clicked = await clickAny(session, ['Standard', 'alles dabei', 'keine']);
      if (clicked) {
        log('clicked multi customization', clicked);
      } else {
        const command = group.required ? 'alle' : 'skip';
        log('no multi bubble, sending', command);
        await session.sendText(command);
      }
    } else {
      const options = group.options || [];
      if (options.length + (group.required ? 0 : 1) > 3) {
        if (typeof session.sendListReply !== 'function') {
          throw new Error(`Single option group ${group.id || group.label} requires WA Web list support`);
        }
        const title = (options[0]?.label || 'Überspringen').slice(0, 24);
        await session.sendListReply({ title });
        log('selected single customization list row', title);
      } else {
        const title = (options[0]?.label || 'Überspringen').slice(0, 20);
        await session.sendButtonReply({ title, fallback: false });
        log('clicked single customization', title);
      }
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error('Timed out completing intent customization');
    }
    sess = await session.waitForSession(
      (next) => next?.state !== 'customizing_intent'
        || customizationPosition(next) !== before,
      { timeoutMs: remainingMs },
    ).catch((err) => {
      throw new Error(`Timed out completing intent customization: ${err.message}`);
    });
  }

  return sess;
}

/**
 * Add the locked Enes delivery basket and assert its delivery postconditions.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void, expectAddress?: 'absent'|'present', phrase?: string }} [opts]
 */
async function addDonerAyranDelivery(session, opts = {}) {
  const log = opts.log || (() => {});
  const expectAddress = opts.expectAddress || 'present';
  if (!['absent', 'present'].includes(expectAddress)) {
    throw new Error(`Unknown delivery address expectation: ${expectAddress}`);
  }
  const phrase = opts.phrase || (
    expectAddress === 'absent' ? DELIVERY_PHRASE_NO_ADDRESS : DELIVERY_PHRASE
  );
  log('place locked döner delivery phrase');
  await session.sendText(phrase);

  let sess = await session.waitForSession(
    (s) => (s?.pendingIntentItems?.length || 0) > 0
      || s?.state === 'customizing_intent'
      || (s?.basket?.length || 0) > 0,
    { timeoutMs: 60_000 },
  );

  if ((sess?.pendingIntentItems?.length || 0) > 0) {
    const clickedAdd = await clickAny(session, ['Hinzufügen', 'Add to basket', 'Sepete ekle']);
    if (clickedAdd) log('clicked', clickedAdd);

    if (!clickedAdd) {
      log('no proposal bubble, sending ja');
      await session.sendText('ja');
      sess = await session.waitForSession(
        (s) => !(s?.pendingIntentItems?.length > 0)
          || s?.state === 'customizing_intent'
          || (s?.basket?.length || 0) >= 2,
        { timeoutMs: 45_000 },
      );
    } else {
      try {
        sess = await session.waitForSession(
          (s) => !(s?.pendingIntentItems?.length > 0)
            || s?.state === 'customizing_intent'
            || (s?.basket?.length || 0) >= 2,
          { timeoutMs: 20_000 },
        );
      } catch (_) {
        log('proposal still pending, sending ja');
        await session.sendText('ja');
        sess = await session.waitForSession(
          (s) => !(s?.pendingIntentItems?.length > 0)
            || s?.state === 'customizing_intent'
            || (s?.basket?.length || 0) >= 2,
          { timeoutMs: 45_000 },
        );
      }
    }
  }

  if (sess?.state === 'customizing_intent') {
    sess = await completeCustomizing(session, { log });
  }

  try {
    sess = await session.waitForSession(
      (s) => (s?.basket?.length || 0) >= 2
        && s?.orderType === 'delivery'
        && (
          expectAddress === 'present'
            ? Boolean(String(s?.deliveryAddress || '').trim())
            : !String(s?.deliveryAddress || '').trim()
        ),
      { timeoutMs: 45_000 },
    );
  } catch (_) {
    sess = await session.getSession();
  }

  const basketLength = sess?.basket?.length || 0;
  if (basketLength < 2) {
    throw new Error(`Expected delivery basket length >= 2, got ${basketLength}`);
  }
  if (sess?.orderType !== 'delivery') {
    throw new Error(`Expected delivery order type, got ${sess?.orderType || 'unset'}`);
  }
  const hasAddress = Boolean(String(sess?.deliveryAddress || '').trim());
  if (expectAddress === 'present' && !hasAddress) {
    throw new Error('Expected non-empty delivery address');
  }
  if (expectAddress === 'absent' && hasAddress) {
    throw new Error('Expected empty delivery address');
  }
  return sess;
}

async function addDonerAyranDeliveryNoAddress(session, opts = {}) {
  return addDonerAyranDelivery(session, { ...opts, expectAddress: 'absent' });
}

async function clearLastDeliveryAddress(session, opts = {}) {
  const log = opts.log || (() => {});
  log('clear saved delivery address for e2e customer');
  return session.clearLastDeliveryAddress();
}

/**
 * Complete the delivery-address picker, text, confirmation, and unit loop.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void, timeoutMs?: number }} [opts]
 */
async function completeDeliveryAddressAsk(session, opts = {}) {
  const log = opts.log || (() => {});
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  let sess = await session.getSession();

  while (/^awaiting_delivery_address/.test(sess?.state || '')) {
    const beforeState = sess.state;
    if (beforeState === 'awaiting_delivery_address_choice') {
      log('select manual delivery address entry');
      await session.sendListReply({
        title: /Adresse eingeben/i,
        openTitle: /Adresse wählen/i,
      });
    } else if (beforeState === 'awaiting_delivery_address') {
      log('send delivery address');
      await session.sendText(ADDRESS_SHORTCIRCUIT);
    } else if (beforeState === 'awaiting_delivery_address_confirm') {
      log('confirm delivery address');
      await session.sendButtonReply({ title: 'Ja', fallback: false });
    } else if (beforeState === 'awaiting_delivery_address_unit') {
      log('select house delivery unit');
      await session.sendText('Haus');
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Timed out completing delivery address (state=${beforeState})`);
    }
    sess = await session.waitForSession(
      (next) => next?.state !== beforeState,
      { timeoutMs: remainingMs },
    ).catch((err) => {
      throw new Error(
        `Timed out completing delivery address (state=${beforeState}): ${err.message}`,
      );
    });
  }

  return sess;
}

/**
 * Confirm an order using a visible localized button, with text fallback.
 * @param {import('../lib/session').WaE2eSession} session
 * @param {{ log?: (...a: any[]) => void }} [opts]
 */
async function confirmOrder(session, opts = {}) {
  const log = opts.log || (() => {});
  const clicked = await clickAny(session, [
    'Bestätigen ✅',
    'Confirm ✅',
    'Bestätigen',
    'Confirm',
  ]);
  if (clicked) {
    log('clicked', clicked);
    return clicked;
  }
  log('no confirm bubble, sending ja');
  await session.sendText('ja');
  return 'ja';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  ADDRESS_SHORTCIRCUIT,
  E2E_DONER_GROUPS,
  clickAny,
  openRestaurant,
  addAyranToBasket,
  startCheckoutFromBasket,
  completeCustomizing,
  addDonerAyranDelivery,
  addDonerAyranDeliveryNoAddress,
  clearLastDeliveryAddress,
  completeDeliveryAddressAsk,
  confirmOrder,
  sleep,
};
