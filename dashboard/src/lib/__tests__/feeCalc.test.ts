import { describe, expect, test } from 'vitest';
import { displayFeeEuros, resolveEffectiveFee, PLATFORM_FEE_DEFAULT } from '../feeCalc';

const platform = { feeType: 'percent' as const, feeValue: 10 };

describe('resolveEffectiveFee', () => {
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

  test('a missing platform feeValue uses the backend default', () => {
    expect(resolveEffectiveFee({ feeType: 'percent' }, null)).toEqual(PLATFORM_FEE_DEFAULT);
  });
});

describe('displayFeeEuros', () => {
  test('uses stored cents for paid and refunded rows', () => {
    expect(displayFeeEuros(
      { total: 29, paymentMethod: 'stripe', paymentStatus: 'refunded', whatorderFeeCents: 0 },
      platform,
      { applyRestaurantFee: true, restaurantOverride: { feeType: 'percent', feeValue: 5 } },
    )).toBe(0);
  });

  test('unpaid stripe uses the restaurant rate only when asked', () => {
    const order = { total: 20, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const };
    const override = { feeType: 'percent' as const, feeValue: 0 };
    expect(displayFeeEuros(order, platform, { applyRestaurantFee: true, restaurantOverride: override })).toBe(0);
    expect(displayFeeEuros(order, platform)).toBe(2);
  });

  test('cash stays on the platform fee', () => {
    const order = { total: 20, paymentMethod: 'cash' as const, paymentStatus: 'cash' as const };
    expect(displayFeeEuros(order, platform, {
      applyRestaurantFee: true,
      restaurantOverride: { feeType: 'percent', feeValue: 0 },
    })).toBe(2);
  });
});
