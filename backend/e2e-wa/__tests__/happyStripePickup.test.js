'use strict';

const { startCheckoutFromBrowsing } = require('../scenarios/happy_stripe_pickup');

test('falls back to fertig when no checkout button is available', async () => {
  const confirming = { state: 'confirming' };
  const session = {
    sendButtonReply: jest.fn(async () => {
      throw new Error('button bubble unavailable');
    }),
    sendText: jest.fn(async () => 'message-id'),
    waitForSession: jest.fn(async (predicate) => {
      expect(predicate(confirming)).toBe(true);
      return confirming;
    }),
  };

  const result = await startCheckoutFromBrowsing(session, { state: 'browsing' });

  expect(session.sendText).toHaveBeenCalledWith('fertig');
  expect(result).toBe(confirming);
});

test('retries fertig when a stale confirm click leaves browsing', async () => {
  const confirming = { state: 'confirming' };
  let waits = 0;
  const session = {
    sendButtonReply: jest.fn(async () => 'btn'),
    sendText: jest.fn(async () => 'message-id'),
    waitForSession: jest.fn(async () => {
      waits += 1;
      if (waits === 1) throw new Error('still browsing');
      return confirming;
    }),
    waWeb: { _dumpDebug: jest.fn(async () => {}) },
  };

  const result = await startCheckoutFromBrowsing(
    session,
    { state: 'browsing' },
    () => {},
  );

  expect(session.sendButtonReply).toHaveBeenCalled();
  expect(session.sendText).toHaveBeenCalledWith('fertig');
  expect(waits).toBe(2);
  expect(result).toBe(confirming);
});
