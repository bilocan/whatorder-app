'use strict';

const mockOrdersRef = jest.fn();

jest.mock('../../src/lib/collections', () => ({
  ordersRef: mockOrdersRef,
  sessionRef: jest.fn(),
  businessRef: jest.fn(),
}));

const { findLatestOrder } = require('../lib/firestoreAssert');

function queryReturning(docs) {
  const snap = {
    empty: docs.length === 0,
    docs: docs.map((order) => ({
      id: order.id,
      data: () => {
        const { id, ...data } = order;
        return data;
      },
    })),
  };
  const query = {
    where: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    limit: jest.fn(() => query),
    get: jest.fn(async () => snap),
  };
  return query;
}

test('findLatestOrder filters by orderType', async () => {
  mockOrdersRef.mockReturnValue(queryReturning([
    {
      id: 'new-pickup',
      status: 'pending',
      paymentMethod: 'stripe',
      orderType: 'pickup',
      createdAt: { seconds: 300 },
    },
    {
      id: 'older-delivery',
      status: 'pending',
      paymentMethod: 'stripe',
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      createdAt: { seconds: 200 },
    },
  ]));

  const order = await findLatestOrder('biz1', ['43660'], {
    afterMs: 0,
    status: 'pending',
    paymentMethod: 'stripe',
    orderType: 'delivery',
  });

  expect(order.id).toBe('older-delivery');
});
