'use strict';

jest.mock('../../src/lib/collections');
jest.mock('../../src/lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        delete: jest.fn(() => 'DELETE_FIELD'),
      },
    },
  },
}));

const { ordersRef, customersRef } = require('../../src/lib/collections');
const { clearLastDeliveryAddress, markOrderPaid } = require('../lib/firestoreAssert');

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

describe('e2e-wa clearLastDeliveryAddress', () => {
  test('is a logged no-op when the customer document does not exist', async () => {
    const mockUpdate = jest.fn();
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    customersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: false,
          id: '436602585284',
        }),
        update: mockUpdate,
      }),
    });

    await expect(clearLastDeliveryAddress('biz_test', '+436602585284'))
      .resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(
      /clearLastDeliveryAddress.*customer not found.*no-op/i,
    ));
    expect(mockUpdate).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  test('deletes saved delivery address fields for the guarded e2e customer', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    customersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          id: '436602585284',
          data: () => ({
            phone: '436602585284',
            lastDeliveryAddress: 'Hauptstraße 5',
            savedAddresses: ['Hauptstraße 5'],
          }),
        }),
        update: mockUpdate,
      }),
    });

    await clearLastDeliveryAddress('biz_test', '+436602585284');

    expect(customersRef).toHaveBeenCalledWith('biz_test');
    expect(mockUpdate).toHaveBeenCalledWith({
      lastDeliveryAddress: 'DELETE_FIELD',
      savedAddresses: 'DELETE_FIELD',
    });
  });

  test('throws without updating when the customer phone does not match', async () => {
    const mockUpdate = jest.fn();
    customersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          id: '436602585284',
          data: () => ({ phone: '439999999999', lastDeliveryAddress: 'Hauptstraße 5' }),
        }),
        update: mockUpdate,
      }),
    });

    await expect(clearLastDeliveryAddress('biz_test', '+436602585284'))
      .rejects.toThrow(/does not match e2e customer/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
