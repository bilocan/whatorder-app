jest.mock('../collections', () => ({
  configRef: jest.fn(),
}));

const { configRef } = require('../collections');
const { getFeeConfig, calcFeeCents, calcFeeEuros, DEFAULT } = require('../feeConfig');

beforeEach(() => jest.clearAllMocks());

describe('calcFeeEuros', () => {
  test('fixed fee returns feeValue', () => {
    expect(calcFeeEuros(29, { feeType: 'fixed', feeValue: 0.5 })).toBe(0.5);
  });

  test('percent fee returns percentage of total', () => {
    expect(calcFeeEuros(100, { feeType: 'percent', feeValue: 10 })).toBe(10);
  });
});

describe('calcFeeCents', () => {
  test('€29 order with fixed €0.50 fee → 50 cents', () => {
    expect(calcFeeCents(2900, { feeType: 'fixed', feeValue: 0.5 })).toBe(50);
  });

  test('€29 order with 3% fee → 87 cents (rounded)', () => {
    expect(calcFeeCents(2900, { feeType: 'percent', feeValue: 3 })).toBe(87);
  });
});

describe('getFeeConfig', () => {
  test('returns defaults when config doc missing', async () => {
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    await expect(getFeeConfig()).resolves.toEqual(DEFAULT);
  });

  test('reads feeType and feeValue from Firestore', async () => {
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ feeType: 'percent', feeValue: 5 }),
      }),
    });
    await expect(getFeeConfig()).resolves.toEqual({ feeType: 'percent', feeValue: 5 });
  });
});
