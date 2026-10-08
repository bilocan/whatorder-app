jest.mock('../collections', () => ({
  configRef: jest.fn(),
}));

const { configRef } = require('../collections');
const { getFeeConfig, calcFeeCents, calcFeeEuros, resolveEffectiveFee, DEFAULT } = require('../feeConfig');

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

  test('keeps a stored zero instead of the default', async () => {
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ feeType: 'percent', feeValue: 0 }),
      }),
    });
    await expect(getFeeConfig()).resolves.toEqual({ feeType: 'percent', feeValue: 0 });
  });

  test('uses the default when feeValue is missing or null', async () => {
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ feeType: 'percent', llmModel: 'x' }),
      }),
    });
    await expect(getFeeConfig()).resolves.toEqual(DEFAULT);

    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ feeType: 'percent', feeValue: null }),
      }),
    });
    await expect(getFeeConfig()).resolves.toEqual(DEFAULT);
  });
});

describe('resolveEffectiveFee', () => {
  const platform = { feeType: 'percent', feeValue: 10 };

  test('uses the platform fee when the restaurant has no override', () => {
    expect(resolveEffectiveFee(platform, null)).toEqual(platform);
    expect(resolveEffectiveFee(platform, undefined)).toEqual(platform);
  });

  test('a zero percent override is a real fee', () => {
    expect(resolveEffectiveFee(platform, { feeType: 'percent', feeValue: 0 })).toEqual({
      feeType: 'percent',
      feeValue: 0,
    });
  });

  test('until is inclusive through the Vienna end of that day', () => {
    const override = { feeType: 'percent', feeValue: 0, until: '2026-12-31' };
    expect(resolveEffectiveFee(platform, override, new Date('2026-12-31T22:59:00.000Z'))).toEqual({
      feeType: 'percent',
      feeValue: 0,
    });
    expect(resolveEffectiveFee(platform, override, new Date('2026-12-31T23:00:00.000Z'))).toEqual(platform);
  });

  test('a bad until or feeType falls back to the platform fee', () => {
    expect(resolveEffectiveFee(platform, { feeType: 'percent', feeValue: 0, until: '31.12.2026' })).toEqual(platform);
    expect(resolveEffectiveFee(platform, { feeType: 'bogus', feeValue: 0 })).toEqual(platform);
    expect(resolveEffectiveFee(platform, { feeType: 'percent', feeValue: null })).toEqual(platform);
  });
});
