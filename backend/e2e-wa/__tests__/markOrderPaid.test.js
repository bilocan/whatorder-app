'use strict';

jest.mock('../../src/lib/collections');

const { ordersRef } = require('../../src/lib/collections');
const { markOrderPaid } = require('../lib/firestoreAssert');

describe('e2e-wa markOrderPaid', () => {
  test('updates paymentStatus to paid', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const orderData = {
      status: 'pending',
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
    };
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn()
          .mockResolvedValueOnce({ exists: true, id: 'ord1', data: () => orderData })
          .mockResolvedValueOnce({
            exists: true,
            id: 'ord1',
            data: () => ({ ...orderData, paymentStatus: 'paid' }),
          }),
        update: mockUpdate,
      }),
    });

    const result = await markOrderPaid('biz_test', 'ord1');

    expect(mockUpdate).toHaveBeenCalledWith({
      paymentStatus: 'paid',
      paymentMethod: 'stripe',
    });
    expect(result.paymentStatus).toBe('paid');
  });

  test('skips update when already paid', async () => {
    const mockUpdate = jest.fn();
    const orderData = {
      status: 'pending',
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
    };
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, id: 'ord1', data: () => orderData }),
        update: mockUpdate,
      }),
    });

    const result = await markOrderPaid('biz_test', 'ord1');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.paymentStatus).toBe('paid');
  });

  test('throws when customerDisplay does not match order', async () => {
    const orderData = {
      status: 'pending',
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
      customerPhone: '439999999999',
    };
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, id: 'ord1', data: () => orderData }),
        update: jest.fn(),
      }),
    });
    await expect(markOrderPaid('biz_test', 'ord1', { customerDisplay: '+436602585284' }))
      .rejects.toThrow(/does not match e2e customer/);
  });
});
