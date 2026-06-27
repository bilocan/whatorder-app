jest.mock('../firebase', () => ({
  db: {
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
const { businessRef, payoutsRef } = require('../collections');
const { getSettlementConfig } = require('../settlementConfig');
const { executeConnectTransfer } = require('../connectTransfer');
const { runPayoutBatch } = require('../payoutService');

describe('runPayoutBatch', () => {
  const mockBatchUpdate = jest.fn();
  const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

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

  test('dry run does not write payout or update orders', async () => {
    const orderRef = { update: jest.fn() };
    db.collectionGroup.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [{
          id: 'order1',
          ref: orderRef,
          data: () => ({ restaurantNetCents: 3000, whatorderFeeCents: 300 }),
          ref: {
            parent: { parent: { id: 'biz1' } },
            update: jest.fn(),
          },
        }],
      }),
    });

    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 3000, whatorderFeeCents: 300 }),
      ref: {
        parent: { parent: { id: 'biz1' } },
        update: jest.fn(),
      },
    };
    db.collectionGroup.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [doc] }),
    });

    const result = await runPayoutBatch({ dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.payouts[0].status).toBe('dry_run');
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('mock mode ignores hold when fetching eligible orders', async () => {
    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 3000, whatorderFeeCents: 300 }),
      ref: { parent: { parent: { id: 'biz1' } }, update: jest.fn() },
    };
    const where = jest.fn().mockReturnThis();
    const get = jest.fn().mockResolvedValue({ docs: [doc] });
    db.collectionGroup.mockReturnValue({ where, get });

    await runPayoutBatch({ dryRun: true });

    expect(where).toHaveBeenCalledWith('settlementStatus', '==', 'pending');
    expect(where).not.toHaveBeenCalledWith('settlementEligibleAt', '<=', expect.any(String));
  });

  test('skips restaurant below minimum payout', async () => {
    const doc = {
      id: 'order1',
      data: () => ({ restaurantNetCents: 500, whatorderFeeCents: 50 }),
      ref: { parent: { parent: { id: 'biz1' } }, update: jest.fn() },
    };
    db.collectionGroup.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [doc] }),
    });

    const result = await runPayoutBatch({ dryRun: false });
    expect(result.payouts[0].status).toBe('skipped_below_minimum');
    expect(executeConnectTransfer).not.toHaveBeenCalled();
  });
});
