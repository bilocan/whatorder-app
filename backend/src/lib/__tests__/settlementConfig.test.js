jest.mock('../collections', () => ({
  settlementConfigRef: jest.fn(),
}));

const { settlementConfigRef } = require('../collections');
const { getSettlementConfig, resolveConnectMode, computeHoldEndsAt, DEFAULT } = require('../settlementConfig');

describe('getSettlementConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PAYOUT_CONNECT_MODE;
  });

  test('returns defaults when doc missing', async () => {
    settlementConfigRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    await expect(getSettlementConfig()).resolves.toEqual(DEFAULT);
  });

  test('resolveConnectMode prefers env', () => {
    process.env.PAYOUT_CONNECT_MODE = 'live';
    expect(resolveConnectMode({ connectMode: 'mock' })).toBe('live');
  });
});

describe('computeHoldEndsAt', () => {
  test('adds holdDays in ms', () => {
    const from = new Date('2026-06-01T12:00:00.000Z');
    const end = computeHoldEndsAt(from, { holdDays: 7 });
    expect(end.toISOString()).toBe('2026-06-08T12:00:00.000Z');
  });
});
