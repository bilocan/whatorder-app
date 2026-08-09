'use strict';

jest.mock('../scenarios/helpers', () => ({
  openRestaurant: jest.fn(async () => {}),
  addAyranToBasket: jest.fn(async () => {}),
  startCheckoutFromBasket: jest.fn(async () => {}),
  completeCustomizing: jest.fn(async () => {}),
  addDonerAyranDelivery: jest.fn(async () => {}),
  addDonerAyranDeliveryNoAddress: jest.fn(async () => {}),
  clearLastDeliveryAddress: jest.fn(async () => {}),
  completeDeliveryAddressAsk: jest.fn(async () => {}),
  confirmOrder: jest.fn(async () => {}),
  clickAny: jest.fn(async () => null),
}));

const {
  runScript,
  validateScript,
  KNOWN_STEP_KINDS,
  KNOWN_MACROS,
  KNOWN_GATES,
} = require('../lib/scriptRunner');
const {
  openRestaurant,
  addAyranToBasket,
  startCheckoutFromBasket,
  completeCustomizing,
  addDonerAyranDelivery,
  addDonerAyranDeliveryNoAddress,
  clearLastDeliveryAddress,
  completeDeliveryAddressAsk,
  confirmOrder,
  clickAny,
} = require('../scenarios/helpers');

function fakeSession(initial = {}) {
  let snap = {
    state: 'confirming',
    basket: [{ name: 'Ayran', qty: 1 }],
    businessId: 'biz_enes_kebap_9450w',
    pendingIntentItems: [],
    ...initial,
  };
  const sends = [];
  return {
    sends,
    cfg: { businessId: 'biz_enes_kebap_9450w', customerDisplay: '+436602585284' },
    sendText: jest.fn(async (t) => { sends.push(t); return 'id'; }),
    waitForReply: jest.fn(async () => ({ text: 'Bitte Zahl klären' })),
    getSession: jest.fn(async () => snap),
    setSnap: (next) => { snap = { ...snap, ...next }; },
    waitForSession: jest.fn(async (pred, opts = {}) => {
      const timeoutMs = opts.timeoutMs || 1000;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (pred(snap)) return snap;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('waitForSession timed out');
    }),
    assertNoNewOrder: jest.fn(async () => {}),
    waitForOrder: jest.fn(async () => ({
      id: 'ord1',
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
      status: 'pending',
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
    })),
    sendButtonReply: jest.fn(async ({ title, fallback }) => {
      if (fallback === false) throw new Error(`No visible WA Web button matching ${title}`);
      return 'btn';
    }),
    resetCustomerSession: jest.fn(async () => {}),
  };
}

test('runs send then expect_reply', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 't1',
    steps: [
      { send: { text: '1' } },
      { expect_reply: { includes: 'klären|clarify|digit' } },
    ],
  });
  expect(session.sendText).toHaveBeenCalledWith('1');
  expect(session.waitForReply).toHaveBeenCalled();
});

test('unknown step kind throws', async () => {
  const session = fakeSession();
  await expect(runScript(session, {
    id: 't2',
    steps: [{ fly: { to: 'moon' } }],
  })).rejects.toThrow(/unknown step/i);
});

test.each([
  [{ sleep: 500 }, /sleep.*object|sleep.*ms/i],
  [{ sleep: {} }, /sleep.*ms/i],
  [{ sleep: { ms: Number.NaN } }, /sleep.*finite/i],
  [{ sleep: { ms: Number.POSITIVE_INFINITY } }, /sleep.*finite/i],
])('sleep rejects invalid body %p', async (step, message) => {
  await expect(runScript(fakeSession(), {
    id: 'bad-sleep',
    steps: [step],
  })).rejects.toThrow(message);
});

test('validateScript exports and accepts the supported vocabulary', () => {
  expect(KNOWN_STEP_KINDS).toEqual(expect.arrayContaining([
    'send', 'expect_reply', 'sleep', 'gate', 'macro', 'tap',
  ]));
  expect(KNOWN_MACROS).toContain('reset_session');
  expect(KNOWN_MACROS).toEqual(expect.arrayContaining([
    'add_doner_ayran_delivery',
    'add_doner_ayran_delivery_no_address',
    'clear_last_delivery_address',
    'complete_delivery_address_ask',
    'complete_customizing',
    'confirm_order',
  ]));
  expect(KNOWN_GATES).toContain('state');
  expect(KNOWN_GATES).toContain('order_stripe_delivery');
  expect(validateScript({
    id: 'valid',
    steps: [
      { send: { text: 'hello' } },
      { expect_reply: { includes: 'welcome' } },
      { sleep: { ms: 1 } },
      { gate: { name: 'state', eq: 'confirming' } },
      { macro: 'reset_session' },
      { tap: { titles: ['Confirm'] } },
    ],
  })).toBeTruthy();
});

test.each([
  [{ expect_reply: {} }, /expect_reply.*includes/i],
  [{ gate: 'state' }, /gate.*object/i],
  [{ gate: { name: 'basket_len' } }, /basket_len.*comparator/i],
  [{ gate: { name: 'basket_qty' } }, /basket_qty.*item_includes|basket_qty.*comparator/i],
  [{ gate: { name: 'basket_qty', eq: 2 } }, /basket_qty.*item_includes/i],
  [{ gate: { name: 'basket_qty', item_includes: 'ayran' } }, /basket_qty.*comparator/i],
  [{ gate: { name: 'state' } }, /state.*comparator/i],
  [{ macro: 'teleport' }, /unknown macro/i],
])('validateScript rejects invalid step %p', (step, message) => {
  expect(() => validateScript({ id: 'invalid', steps: [step] })).toThrow(message);
});

test.each([
  [
    { name: 'basket_qty', item_include: 'ayran', eq: 2 },
    /basket_qty.*unknown key.*item_include/i,
  ],
  [
    { name: 'order_stripe', paymentStatu: 'pending' },
    /order_stripe.*unknown key.*paymentStatu/i,
  ],
  [
    { name: 'order_stripe_delivery', address_include: 'Hauptstraße' },
    /order_stripe_delivery.*unknown key.*address_include/i,
  ],
])('validateScript rejects unknown keys for strict gate %p', (gate, message) => {
  expect(() => validateScript({
    id: 'invalid-gate-key',
    steps: [{ gate }],
  })).toThrow(message);
});

test('soft expect_reply does not throw when waitForReply fails', async () => {
  const session = fakeSession();
  session.waitForReply.mockRejectedValue(new Error('timeout'));
  await expect(runScript(session, {
    id: 't3',
    steps: [{ expect_reply: { includes: 'x', soft: true } }],
  })).resolves.toEqual({ ok: true });
});

test('hard expect_reply throws when waitForReply fails', async () => {
  const session = fakeSession();
  session.waitForReply.mockRejectedValue(new Error('timeout'));
  await expect(runScript(session, {
    id: 't4',
    steps: [{ expect_reply: { includes: 'x' } }],
  })).rejects.toThrow(/timeout/);
});

test('gate state in confirming', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'g1',
    steps: [{ gate: { name: 'state', in: ['confirming'] } }],
  });
  expect(session.waitForSession).toHaveBeenCalled();
});

test('gate basket_len eq', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'g2',
    steps: [{ gate: { name: 'basket_len', eq: 1 } }],
  });
});

test('gate basket_qty eq sums qty on one matching line', async () => {
  const session = fakeSession({
    basket: [{ name: 'Ayran 0.25l', qty: 2 }],
  });
  await runScript(session, {
    id: 'g-basket-qty-1',
    steps: [{ gate: { name: 'basket_qty', item_includes: 'ayran', eq: 2 } }],
  });
  expect(session.waitForSession).toHaveBeenCalled();
});

test('gate basket_qty eq sums qty across multiple matching lines', async () => {
  const session = fakeSession({
    basket: [
      { name: 'Ayran 0.25l', qty: 1 },
      { name: 'Extra Ayran', qty: 1 },
      { name: 'Döner', qty: 3 },
    ],
  });
  await runScript(session, {
    id: 'g-basket-qty-2',
    steps: [{ gate: { name: 'basket_qty', item_includes: 'ayran', eq: 2 } }],
  });
});

test('gate basket_qty matches item names case-insensitively', async () => {
  const session = fakeSession({
    basket: [{ name: 'AYRAN', qty: 2 }],
  });
  await runScript(session, {
    id: 'g-basket-qty-ci',
    steps: [{ gate: { name: 'basket_qty', item_includes: 'ayran', eq: 2 } }],
  });
});

test('gate basket_qty times out when no matching line reaches qty', async () => {
  const session = fakeSession({
    basket: [{ name: 'Döner', qty: 1 }],
  });
  session.waitForSession.mockImplementation(async (_pred, opts = {}) => {
    throw new Error('waitForSession timed out');
  });
  await expect(runScript(session, {
    id: 'g-basket-qty-miss',
    steps: [{ gate: { name: 'basket_qty', item_includes: 'ayran', eq: 2 } }],
  })).rejects.toThrow(/timed out/i);
});

test('unknown gate throws', async () => {
  const session = fakeSession();
  await expect(runScript(session, {
    id: 'g3',
    steps: [{ gate: { name: 'teleport' } }],
  })).rejects.toThrow(/unknown gate/i);
});

test('macro reset_session calls session.resetCustomerSession', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'm1',
    steps: [{ macro: 'reset_session' }],
  });
  expect(session.resetCustomerSession).toHaveBeenCalled();
});

test('ensure_confirming sends name when awaiting_name', async () => {
  const session = fakeSession({ state: 'awaiting_name', basket: [{ name: 'Ayran', qty: 1 }] });
  session.waitForSession.mockImplementation(async (pred) => {
    if (session.sends.includes('E2E Testkunde')) {
      session.setSnap({ state: 'confirming' });
    }
    if (pred(await session.getSession())) return session.getSession();
    throw new Error('waitForSession timed out');
  });
  await runScript(session, {
    id: 'm2',
    steps: [{ macro: 'ensure_confirming' }],
  });
  expect(session.sendText).toHaveBeenCalledWith('E2E Testkunde');
});

test('ensure_confirming hard-fails on any delivery address state', async () => {
  const session = fakeSession({ state: 'awaiting_delivery_address_choice' });
  await expect(runScript(session, {
    id: 'm3',
    steps: [{ macro: 'ensure_confirming' }],
  })).rejects.toThrow(/front-load|delivery address/i);
  expect(session.waitForSession).not.toHaveBeenCalled();
});

test('ensure_confirming waits until the session reaches confirming', async () => {
  const session = fakeSession({ state: 'checkout_processing' });
  session.waitForSession.mockImplementation(async (pred) => {
    session.setSnap({ state: 'confirming' });
    const snap = await session.getSession();
    if (pred(snap)) return snap;
    throw new Error('waitForSession timed out');
  });
  await runScript(session, {
    id: 'm4',
    steps: [{ macro: 'ensure_confirming' }],
  });
  expect(session.waitForSession).toHaveBeenCalledWith(
    expect.any(Function),
    expect.objectContaining({ timeoutMs: expect.any(Number) }),
  );
});

test('tap throws when no button matches', async () => {
  const session = fakeSession();
  await expect(runScript(session, {
    id: 'tap1',
    steps: [{ tap: { titles: ['Nope'] } }],
  })).rejects.toThrow(/button|tap/i);
  expect(clickAny).toHaveBeenCalledWith(session, ['Nope']);
});

test('order_stripe calls waitForOrder with paymentMethod stripe', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'os1',
    steps: [{ gate: { name: 'order_stripe' } }],
  });
  expect(session.waitForOrder).toHaveBeenCalledWith(expect.objectContaining({
    paymentMethod: 'stripe',
  }));
});

test('order_stripe_delivery requires a Stripe delivery order with matching address', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'delivery-order',
    steps: [{
      gate: {
        name: 'order_stripe_delivery',
        address_includes: 'Hauptstraße',
        timeout_ms: 1234,
      },
    }],
  });
  expect(session.waitForOrder).toHaveBeenCalledWith({
    paymentMethod: 'stripe',
    status: 'pending',
    orderType: 'delivery',
    timeoutMs: 1234,
    afterMs: expect.any(Number),
  });
});

test('order_stripe_delivery rejects a pickup order', async () => {
  const session = fakeSession();
  session.waitForOrder.mockResolvedValue({
    orderType: 'pickup',
    deliveryAddress: 'Hauptstraße 5',
  });
  await expect(runScript(session, {
    steps: [{ gate: { name: 'order_stripe_delivery' } }],
  })).rejects.toThrow(/delivery.*pickup/i);
});

test('order_stripe_delivery rejects an empty delivery address', async () => {
  const session = fakeSession();
  session.waitForOrder.mockResolvedValue({ orderType: 'delivery', deliveryAddress: ' ' });
  await expect(runScript(session, {
    steps: [{ gate: { name: 'order_stripe_delivery' } }],
  })).rejects.toThrow(/missing deliveryAddress/i);
});

test('order_stripe_delivery rejects a delivery address mismatch', async () => {
  const session = fakeSession();
  session.waitForOrder.mockResolvedValue({
    orderType: 'delivery',
    deliveryAddress: 'Nebenstraße 9',
  });
  await expect(runScript(session, {
    steps: [{
      gate: { name: 'order_stripe_delivery', address_includes: 'Hauptstraße' },
    }],
  })).rejects.toThrow(/address missing Hauptstraße.*Nebenstraße 9/i);
});

test('order_stripe_delivery rejects unexpected paymentStatus', async () => {
  const session = fakeSession();
  session.waitForOrder.mockResolvedValue({
    orderType: 'delivery',
    deliveryAddress: 'Hauptstraße 5',
    paymentStatus: 'failed',
  });
  await expect(runScript(session, {
    steps: [{ gate: { name: 'order_stripe_delivery' } }],
  })).rejects.toThrow(/paymentStatus.*pending.*failed/);
});

test.each([
  ['business_bound', { name: 'business_bound' }],
  ['basket_empty', { name: 'basket_empty' }],
  ['pending_intent', { name: 'pending_intent', gte: 0 }],
])('gate %s waits for matching session', async (_name, gate) => {
  const session = fakeSession({ basket: [] });
  await runScript(session, { steps: [{ gate }] });
  expect(session.waitForSession).toHaveBeenCalled();
});

test('fertig_confirm_checkout yaml: send fertig then require leave browsing', async () => {
  const path = require('path');
  const { loadScriptFile } = require('../lib/scriptLoader');
  const doc = loadScriptFile(path.join(__dirname, '../scripts/fertig_confirm_checkout.yml'));
  const session = fakeSession({
    state: 'browsing',
    basket: [{ name: 'Ayran', qty: 1, price: 2 }],
  });
  session.waitForSession.mockImplementation(async (pred) => {
    let snap = await session.getSession();
    if (pred(snap)) return snap;
    // After customer types fertig, checkout entry leaves browsing.
    if (session.sends.includes('fertig')) {
      session.setSnap({ state: 'awaiting_name' });
      snap = await session.getSession();
      if (pred(snap)) return snap;
    }
    throw new Error('waitForSession timed out');
  });

  await runScript(session, doc);

  expect(session.sendText).toHaveBeenCalledWith('fertig');
  expect(openRestaurant).toHaveBeenCalled();
  expect(addAyranToBasket).toHaveBeenCalled();
  expect(startCheckoutFromBasket).not.toHaveBeenCalled();
});

test('gate no_order delegates timeout to assertNoNewOrder', async () => {
  const session = fakeSession();
  await runScript(session, {
    steps: [{ gate: { name: 'no_order', timeout_ms: 1234 } }],
  });
  expect(session.assertNoNewOrder).toHaveBeenCalledWith({
    timeoutMs: 1234,
    afterMs: expect.any(Number),
  });
});

test('sequential runScript calls isolate no_order via per-script afterMs', async () => {
  const session = fakeSession();
  session.startedAtMs = Date.now() - 60_000;

  let script1AfterMs;
  session.waitForOrder.mockImplementation(async (opts) => {
    script1AfterMs = opts.afterMs;
    return {
      id: 'ord1',
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
      status: 'pending',
    };
  });

  session.assertNoNewOrder.mockImplementation(async (opts) => {
    if (opts.afterMs <= script1AfterMs) {
      throw new Error('Unexpected order found (session-level afterMs would false-fail)');
    }
  });

  await runScript(session, {
    id: 'script1',
    steps: [{ gate: { name: 'order_stripe' } }],
  });

  await new Promise((r) => setTimeout(r, 5));

  await expect(runScript(session, {
    id: 'script2',
    steps: [{ gate: { name: 'no_order' } }],
  })).resolves.toEqual({ ok: true });

  expect(session.assertNoNewOrder).toHaveBeenCalledWith({
    timeoutMs: expect.any(Number),
    afterMs: expect.any(Number),
  });
  const noOrderAfterMs = session.assertNoNewOrder.mock.calls.at(-1)[0].afterMs;
  expect(noOrderAfterMs).toBeGreaterThan(script1AfterMs);
});

test('order gates pass per-script afterMs unless YAML sets afterMs explicitly', async () => {
  const session = fakeSession();
  const explicitAfterMs = 9_999_999;

  await runScript(session, {
    id: 'explicit-after',
    steps: [
      { gate: { name: 'order_stripe', afterMs: explicitAfterMs } },
      { gate: { name: 'order_stripe_delivery', afterMs: explicitAfterMs } },
    ],
  });

  expect(session.waitForOrder).toHaveBeenNthCalledWith(1, expect.objectContaining({
    afterMs: explicitAfterMs,
  }));
  expect(session.waitForOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({
    afterMs: explicitAfterMs,
  }));
});

test('order gates buffer the per-script afterMs against clock skew', async () => {
  const session = fakeSession();
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(50_000);

  await runScript(session, {
    id: 'clock-skew-buffer',
    steps: [{ gate: { name: 'order_stripe' } }],
  });

  expect(session.waitForOrder).toHaveBeenCalledWith(expect.objectContaining({
    afterMs: 45_000,
  }));
  nowSpy.mockRestore();
});

test('order_stripe validates optional paymentStatus', async () => {
  const session = fakeSession();
  session.waitForOrder.mockResolvedValue({ paymentStatus: 'failed' });
  await expect(runScript(session, {
    steps: [{ gate: { name: 'order_stripe', paymentStatus: 'pending' } }],
  })).rejects.toThrow(/paymentStatus.*pending.*failed/);
});

test('macro object form opens restaurant', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'macro-object',
    steps: [{ macro: { name: 'open_restaurant' } }],
  });
  expect(openRestaurant).toHaveBeenCalledWith(session, expect.objectContaining({
    log: expect.any(Function),
  }));
});

test('add_ayran_pickup macro passes locked pickup phrase', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'ayran',
    steps: [{ macro: 'add_ayran_pickup' }],
  });
  expect(addAyranToBasket).toHaveBeenCalledWith(session, expect.objectContaining({
    log: expect.any(Function),
    phrase: '1 ayran zum Abholen',
  }));
});

test('start_checkout macro delegates to helper', async () => {
  const session = fakeSession();
  await runScript(session, {
    id: 'checkout',
    steps: [{ macro: 'start_checkout' }],
  });
  expect(startCheckoutFromBasket).toHaveBeenCalledWith(session, expect.objectContaining({
    log: expect.any(Function),
  }));
});

test.each([
  ['add_doner_ayran_delivery', addDonerAyranDelivery],
  ['add_doner_ayran_delivery_no_address', addDonerAyranDeliveryNoAddress],
  ['clear_last_delivery_address', clearLastDeliveryAddress],
  ['complete_delivery_address_ask', completeDeliveryAddressAsk],
  ['complete_customizing', completeCustomizing],
  ['confirm_order', confirmOrder],
])('%s macro delegates to its helper with a logger', async (macro, helper) => {
  const session = fakeSession();
  await runScript(session, {
    id: `macro-${macro}`,
    steps: [{ macro }],
  });
  expect(helper).toHaveBeenCalledWith(session, {
    log: expect.any(Function),
    ...(macro === 'complete_delivery_address_ask' ? { timeoutMs: expect.any(Number) } : {}),
  });
});

test('unknown macro throws', async () => {
  await expect(runScript(fakeSession(), {
    steps: [{ macro: 'teleport' }],
  })).rejects.toThrow(/unknown macro/i);
});

test('tap succeeds when clickAny finds a button', async () => {
  const session = fakeSession();
  clickAny.mockResolvedValueOnce('Confirm');
  await expect(runScript(session, {
    steps: [{ tap: { titles: ['Confirm'] } }],
  })).resolves.toEqual({ ok: true });
});
