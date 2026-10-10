'use strict';

jest.mock('../../src/bot/customerLanguage', () => ({
  setPreferredLanguage: jest.fn(async () => {}),
}));

const { setPreferredLanguage } = require('../../src/bot/customerLanguage');
const { bindRestaurant, openRestaurant } = require('../scenarios/helpers');

const BUSINESS_ID = 'biz_enes_kebap_9450w';

function sessionStub(waitForSession) {
  return {
    cfg: {
      businessId: BUSINESS_ID,
      customerDisplay: '+436602898096',
    },
    resetCustomerSession: jest.fn(async () => {}),
    sendText: jest.fn(async () => 'mid'),
    sendButtonReply: jest.fn(async () => {
      throw new Error('button bubble unavailable');
    }),
    waitForSession,
  };
}

beforeEach(() => {
  setPreferredLanguage.mockClear();
});

test('bindRestaurant skips the language keyword when ORDER+ already binds the restaurant', async () => {
  const bound = { state: 'browsing', businessId: BUSINESS_ID };
  const session = sessionStub(jest.fn(async (predicate) => {
    expect(predicate(bound)).toBe(true);
    expect(predicate({ state: 'awaiting_language', businessId: null })).toBe(true);
    expect(predicate({ state: 'awaiting_language', businessId: BUSINESS_ID })).toBe(true);
    expect(predicate(null)).toBe(false);
    return bound;
  }));

  const result = await bindRestaurant(session, { log: () => {} });

  expect(setPreferredLanguage).toHaveBeenCalledWith('+436602898096', 'de');
  expect(session.sendText).toHaveBeenCalledTimes(1);
  expect(session.sendText).toHaveBeenCalledWith(`ORDER+${BUSINESS_ID}`);
  expect(result).toBe(bound);
});

test('bindRestaurant sends de when the language gate stashes the deep link', async () => {
  const picking = { state: 'awaiting_language', businessId: null, pendingDeepBid: BUSINESS_ID };
  const bound = { state: 'browsing', businessId: BUSINESS_ID };
  let calls = 0;
  const session = sessionStub(jest.fn(async (predicate) => {
    calls += 1;
    if (calls === 1) {
      expect(predicate(picking)).toBe(true);
      expect(predicate(bound)).toBe(true);
      return picking;
    }
    expect(predicate(bound)).toBe(true);
    expect(predicate(picking)).toBe(false);
    return bound;
  }));

  const result = await bindRestaurant(session, { log: () => {} });

  expect(session.sendText.mock.calls.map(([body]) => body)).toEqual([
    `ORDER+${BUSINESS_ID}`,
    'de',
  ]);
  expect(result).toBe(bound);
});

test('bindRestaurant sends de when the restaurant session never appears', async () => {
  const bound = { state: 'browsing', businessId: BUSINESS_ID };
  let calls = 0;
  const session = sessionStub(jest.fn(async () => {
    calls += 1;
    if (calls === 1) throw new Error('waitForSession timed out');
    return bound;
  }));

  const result = await bindRestaurant(session, { log: () => {} });

  expect(session.sendText.mock.calls.map(([body]) => body)).toEqual([
    `ORDER+${BUSINESS_ID}`,
    'de',
  ]);
  expect(result).toBe(bound);
});

test('openRestaurant resets the session before binding the restaurant', async () => {
  jest.useFakeTimers();
  const bound = { state: 'browsing', businessId: BUSINESS_ID };
  const session = sessionStub(jest.fn(async () => bound));

  const pending = openRestaurant(session, { log: () => {} });
  await jest.advanceTimersByTimeAsync(2500);
  await pending;
  jest.useRealTimers();

  expect(session.resetCustomerSession).toHaveBeenCalledTimes(1);
  const resetOrder = session.resetCustomerSession.mock.invocationCallOrder[0];
  const pinOrder = setPreferredLanguage.mock.invocationCallOrder[0];
  const sendOrder = session.sendText.mock.invocationCallOrder[0];
  expect(resetOrder).toBeLessThan(pinOrder);
  expect(pinOrder).toBeLessThan(sendOrder);
});
