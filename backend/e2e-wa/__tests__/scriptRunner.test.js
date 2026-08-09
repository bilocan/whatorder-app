'use strict';

jest.mock('../scenarios/helpers', () => ({
  openRestaurant: jest.fn(async () => {}),
  addAyranToBasket: jest.fn(async () => {}),
  startCheckoutFromBasket: jest.fn(async () => {}),
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
      id: 'ord1', paymentMethod: 'stripe', paymentStatus: 'pending', status: 'pending',
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
  expect(KNOWN_GATES).toContain('state');
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
  [{ gate: { name: 'state' } }, /state.*comparator/i],
  [{ macro: 'teleport' }, /unknown macro/i],
])('validateScript rejects invalid step %p', (step, message) => {
  expect(() => validateScript({ id: 'invalid', steps: [step] })).toThrow(message);
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

test('ensure_confirming throws on delivery address state', async () => {
  const session = fakeSession({ state: 'awaiting_delivery_address' });
  await expect(runScript(session, {
    id: 'm3',
    steps: [{ macro: 'ensure_confirming' }],
  })).rejects.toThrow(/confirming/i);
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

test.each([
  ['business_bound', { name: 'business_bound' }],
  ['basket_empty', { name: 'basket_empty' }],
  ['pending_intent', { name: 'pending_intent', gte: 0 }],
])('gate %s waits for matching session', async (_name, gate) => {
  const session = fakeSession({ basket: [] });
  await runScript(session, { steps: [{ gate }] });
  expect(session.waitForSession).toHaveBeenCalled();
});

test('gate no_order delegates timeout to assertNoNewOrder', async () => {
  const session = fakeSession();
  await runScript(session, {
    steps: [{ gate: { name: 'no_order', timeout_ms: 1234 } }],
  });
  expect(session.assertNoNewOrder).toHaveBeenCalledWith({ timeoutMs: 1234 });
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
