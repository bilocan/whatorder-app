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
