'use strict';

jest.mock('../../src/bot/orderService', () => ({
  approveOrder: jest.fn(async () => {}),
  startPreparation: jest.fn(async () => {}),
  markReady: jest.fn(async () => {}),
  cancelOrder: jest.fn(async () => {}),
  getOrder: jest.fn(async (_biz, id) => ({ id, status: 'cancelled' })),
}));

const { cancelOrder, getOrder } = require('../../src/bot/orderService');
const { ownerCancel } = require('../lib/ownerActions');

test('ownerCancel cancels with skipReentry by default', async () => {
  await ownerCancel('biz1', 'ord1');
  expect(cancelOrder).toHaveBeenCalledWith('biz1', 'ord1', { skipReentry: true });
  expect(getOrder).toHaveBeenCalledWith('biz1', 'ord1');
});
