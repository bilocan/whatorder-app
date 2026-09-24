jest.mock('../firebase', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'TS') } } },
}));
jest.mock('../collections', () => ({
  wallboardFeedRef: jest.fn(),
}));

const { wallboardFeedRef } = require('../collections');
const { boardStatus, writeWallboardFeedOnCreate, updateWallboardFeedIfExists } = require('../wallboardFeed');

describe('boardStatus', () => {
  test('rejected and cancelled win', () => {
    expect(boardStatus({ status: 'rejected', paymentMethod: 'stripe', paymentStatus: 'pending' })).toBe('rejected');
    expect(boardStatus({ status: 'cancelled', paymentMethod: 'cash', paymentStatus: 'cash' })).toBe('cancelled');
  });

  test('picked up, delivered, and legacy kitchen completed', () => {
    expect(boardStatus({ status: 'picked_up', paymentMethod: 'cash', paymentStatus: 'cash' })).toBe('completed');
    expect(boardStatus({ status: 'delivered', paymentMethod: 'stripe', paymentStatus: 'paid' })).toBe('completed');
    expect(boardStatus({ status: 'completed', paymentMethod: 'cash', paymentStatus: 'cash' })).toBe('completed');
  });

  test('unpaid or failed stripe is pending payment', () => {
    expect(boardStatus({ status: 'pending', paymentMethod: 'stripe', paymentStatus: 'pending' })).toBe('pending_payment');
    expect(boardStatus({ status: 'pending', paymentMethod: 'stripe', paymentStatus: 'failed' })).toBe('pending_payment');
  });

  test('cash just placed and paid card still in kitchen are in progress', () => {
    expect(boardStatus({ status: 'pending', paymentMethod: 'cash', paymentStatus: 'cash' })).toBe('in_progress');
    expect(boardStatus({ status: 'preparing', paymentMethod: 'stripe', paymentStatus: 'paid' })).toBe('in_progress');
  });

  test('completed kitchen stays completed when refunded', () => {
    expect(boardStatus({ status: 'delivered', paymentMethod: 'stripe', paymentStatus: 'refunded' })).toBe('completed');
  });
});

describe('writeWallboardFeedOnCreate', () => {
  test('sets only the feed fields', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    wallboardFeedRef.mockReturnValue({ set });
    await writeWallboardFeedOnCreate('biz_1', 'ord_1', {
      restaurantName: 'Enes',
      total: 12.5,
      status: 'pending',
      paymentMethod: 'cash',
      paymentStatus: 'cash',
      orderType: 'pickup',
      customerPhone: '43664111',
      customerName: 'Ada',
    }, true);
    expect(set).toHaveBeenCalledWith({
      businessId: 'biz_1',
      restaurantName: 'Enes',
      total: 12.5,
      createdAt: expect.anything(),
      boardStatus: 'in_progress',
      paymentStatus: 'cash',
      orderType: 'pickup',
      firstOrder: true,
    });
    const doc = set.mock.calls[0][0];
    expect(doc.customerPhone).toBeUndefined();
    expect(doc.customerName).toBeUndefined();
  });

  test('logs and does not throw when set fails', async () => {
    wallboardFeedRef.mockReturnValue({ set: jest.fn().mockRejectedValue(new Error('nope')) });
    await expect(writeWallboardFeedOnCreate('biz_1', 'ord_1', {
      restaurantName: 'Enes', total: 1, status: 'pending', paymentMethod: 'cash', paymentStatus: 'cash',
    }, false)).resolves.toBeUndefined();
  });
});

describe('updateWallboardFeedIfExists', () => {
  test('does not create a missing doc', async () => {
    const set = jest.fn();
    wallboardFeedRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }), set });
    await updateWallboardFeedIfExists('ord_1', { status: 'delivered', paymentMethod: 'stripe', paymentStatus: 'paid', total: 9 });
    expect(set).not.toHaveBeenCalled();
  });

  test('merges board status, payment status, and total', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    wallboardFeedRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true }), set });
    await updateWallboardFeedIfExists('ord_1', {
      status: 'delivered', paymentMethod: 'stripe', paymentStatus: 'paid', total: 9, orderType: 'delivery',
    });
    expect(set).toHaveBeenCalledWith(
      { boardStatus: 'completed', paymentStatus: 'paid', total: 9, orderType: 'delivery' },
      { merge: true },
    );
    const patch = set.mock.calls[0][0];
    expect(patch.firstOrder).toBeUndefined();
    expect(patch.createdAt).toBeUndefined();
  });

  test('logs and does not throw when the update fails, and omits total when it is not a number', async () => {
    const set = jest.fn().mockRejectedValue(new Error('nope'));
    wallboardFeedRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true }), set });
    await expect(updateWallboardFeedIfExists('ord_1', {
      status: 'pending', paymentMethod: 'cash', paymentStatus: 'cash',
    })).resolves.toBeUndefined();
  });
});
