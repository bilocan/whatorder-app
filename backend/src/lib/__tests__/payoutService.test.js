jest.mock('../firebase', () => ({
  db: {
    collection: jest.fn(),
    collectionGroup: jest.fn(),
    batch: jest.fn(),
  },
  admin: {
    firestore: {
      FieldValue: { serverTimestamp: jest.fn(() => 'TS') },
    },
  },
}));

jest.mock('../collections', () => ({
  businessRef: jest.fn(),
  businessesCollectionRef: jest.fn(),
  ordersRef: jest.fn(),
  payoutsRef: jest.fn(),
}));

jest.mock('../settlementConfig', () => ({
  getSettlementConfig: jest.fn(),
  resolveConnectMode: jest.fn(() => 'mock'),
}));

jest.mock('../connectTransfer', () => ({
  executeConnectTransfer: jest.fn(),
}));

const { db } = require('../firebase');
const { businessRef, businessesCollectionRef, ordersRef, payoutsRef } = require('../collections');
const { getSettlementConfig } = require('../settlementConfig');
const { executeConnectTransfer } = require('../connectTransfer');
const { runPayoutBatch } = require('../payoutService');

describe('runPayoutBatch', () => {
  const mockBatchUpdate = jest.fn();
  const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

  function mockPerBusinessOrders(docs) {
    businessesCollectionRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: [{ id: 'biz1' }] }),
    });
    ordersRef.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs }),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getSettlementConfig.mockResolvedValue({
      holdDays: 7,
      minimumPayoutCents: 2500,
      connectMode: 'mock',
      mockIgnoreHold: true,
    });
    db.batch.mockReturnValue({ update: mockBatchUpdate, commit: mockBatchCommit });
    payoutsRef.mockReturnValue({
      doc: jest.fn(() => ({
        id: 'payout_1',
        set: jest.fn().mockResolvedValue(undefined),
      })),
    });
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Test' }) }),
    });
    executeConnectTransfer.mockResolvedValue({
      mode: 'mock',
      transferId: 'mock_tr_payout_1',
      connectAccountId: 'mock_acct_biz1',
    });
  });

  function mockMissingCollectionGroupIndex() {
    db.collectionGroup.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockRejectedValue(new Error('The query requires an index')),
    });
  }

  function mockCollectionGroupOrders(docs) {
    db.collectionGroup.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs }),
    });
  }

  test('mock mode uses composite collectionGroup query (not single-field)', async () => {
    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 3000, settlementEligibleAt: '2099-01-01T00:00:00.000Z' }),
      ref: { parent: { parent: { id: 'biz1' } }, update: jest.fn() },
    };
    mockCollectionGroupOrders([doc]);

    const result = await runPayoutBatch({ dryRun: true });
    expect(result.eligibleOrderCount).toBe(1);
    const cg = db.collectionGroup.mock.results[0].value;
    expect(cg.where).toHaveBeenCalledTimes(2);
    expect(cg.where).toHaveBeenCalledWith('settlementEligibleAt', '<=', '9999-12-31T23:59:59.999Z');
  });

  test('falls back to per-business scan when collectionGroup index missing', async () => {
    mockMissingCollectionGroupIndex();
    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 3000, whatorderFeeCents: 300 }),
      ref: { parent: { parent: { id: 'biz1' } }, update: jest.fn() },
    };
    mockPerBusinessOrders([doc]);

    const result = await runPayoutBatch({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.payouts[0].status).toBe('dry_run');
    expect(db.collectionGroup).toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('mock mode ignores hold when fetching eligible orders', async () => {
    mockMissingCollectionGroupIndex();
    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 3000, settlementEligibleAt: '2099-01-01T00:00:00.000Z' }),
      ref: { parent: { parent: { id: 'biz1' } }, update: jest.fn() },
    };
    mockPerBusinessOrders([doc]);

    const result = await runPayoutBatch({ dryRun: true });
    expect(result.eligibleOrderCount).toBe(1);
  });

  test('skips restaurant below minimum payout', async () => {
    mockMissingCollectionGroupIndex();
    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 500, whatorderFeeCents: 50 }),
      ref: { parent: { parent: { id: 'biz1' } }, update: jest.fn() },
    };
    mockPerBusinessOrders([doc]);

    const result = await runPayoutBatch({ dryRun: false });
    expect(result.payouts[0].status).toBe('skipped_below_minimum');
    expect(executeConnectTransfer).not.toHaveBeenCalled();
  });
});
