import { describe, expect, test } from 'vitest';
import { earningsByFeeRate, earningsStatusSplit, restaurantRevenueEuros, whatorderEarningsEuros } from '../earningsTotals';

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

  test('splits every order into all, cancelled, rejected, and kept', () => {
    const orders = [
      { status: 'picked_up' as const, total: 10 },
      { status: 'cancelled' as const, total: 5 },
      { status: 'rejected' as const, total: 20 },
      { status: 'preparing' as const, total: 8 },
    ];
    expect(earningsStatusSplit(orders)).toEqual({
      all: { count: 4, euros: 43 },
      cancelled: { count: 1, euros: 5 },
      rejected: { count: 1, euros: 20 },
      kept: { count: 2, euros: 18 },
    });
  });

  test('groups kept orders by the restaurant fee and leaves cancelled and rejected out', () => {
    const zero = { feeType: 'percent' as const, feeValue: 0 };
    const orders = [
      { status: 'picked_up' as const, total: 10, restaurantFee: zero },
      { status: 'cancelled' as const, total: 5, restaurantFee: zero },
      { status: 'picked_up' as const, total: 20, restaurantFee: { feeType: 'percent' as const, feeValue: 10 } },
      { status: 'rejected' as const, total: 8 },
      { status: 'preparing' as const, total: 4, restaurantFee: { feeType: 'fixed' as const, feeValue: 0.5 } },
    ];
    expect(earningsByFeeRate(orders, platform)).toEqual([
      { feeType: 'percent', feeValue: 0, count: 1, euros: 10 },
      { feeType: 'percent', feeValue: 10, count: 1, euros: 20 },
      { feeType: 'fixed', feeValue: 0.5, count: 1, euros: 4 },
    ]);
  });

  test('keeps an in-progress order in revenue and still estimates its fee', () => {
    const order = { status: 'preparing' as const, total: 20, paymentMethod: 'stripe' as const, paymentStatus: 'pending' as const };
    expect(restaurantRevenueEuros([order])).toBe(20);
    expect(whatorderEarningsEuros([order], platform)).toBe(2);
  });

  test('an unpaid order on a zero percent restaurant does not pick up the platform rate', () => {
    const order = {
      status: 'preparing' as const,
      total: 20,
      paymentMethod: 'stripe' as const,
      paymentStatus: 'pending' as const,
      restaurantFee: { feeType: 'percent' as const, feeValue: 0 },
    };
    expect(whatorderEarningsEuros([order], platform)).toBe(0);
  });
});
