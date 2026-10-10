import { describe, expect, test } from 'vitest';
import { restaurantRevenueEuros, whatorderEarningsEuros } from '../earningsTotals';

const platform = { feeType: 'percent' as const, feeValue: 10 };

describe('admin earnings totals', () => {
  test('drops cancelled and rejected orders from restaurant revenue and WhatOrder earnings', () => {
    const orders = [
      { status: 'picked_up' as const, total: 10.96, paymentMethod: 'stripe' as const, paymentStatus: 'paid' as const, whatorderFeeCents: 5 },
      { status: 'cancelled' as const, total: 10.96, paymentMethod: 'stripe' as const, paymentStatus: 'refunded' as const, settlementStatus: 'refunded' as const, whatorderFeeCents: 5 },
      { status: 'rejected' as const, total: 43.6, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const },
      { status: 'cancelled' as const, total: 15.98, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const },
      { status: 'rejected' as const, total: 13.9, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const },
    ];

    expect(restaurantRevenueEuros(orders)).toBeCloseTo(10.96);
    expect(whatorderEarningsEuros(orders, platform)).toBeCloseTo(0.05);
  });

  test('does not invent a platform fee for an unpaid withdrawn order', () => {
    const order = { status: 'rejected' as const, total: 43.6, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const };
    expect(whatorderEarningsEuros([order], platform)).toBe(0);
  });

  test('keeps an in-progress order in revenue and still estimates its fee', () => {
    const order = { status: 'preparing' as const, total: 20, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const };
    expect(restaurantRevenueEuros([order])).toBe(20);
    expect(whatorderEarningsEuros([order], platform)).toBe(2);
  });
});
