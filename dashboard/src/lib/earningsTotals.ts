import { displayFeeEuros, type FeeConfig } from './feeCalc';

type EarningsOrder = {
  status?: string;
  total: number;
  paymentMethod?: string;
  paymentStatus?: string;
  settlementStatus?: string;
  whatorderFeeCents?: number;
};

const WITHDRAWN = new Set(['cancelled', 'rejected']);

/** Cancelled and rejected orders are not restaurant revenue. */
export function countsTowardRestaurantRevenue(order: { status?: string }): boolean {
  return !WITHDRAWN.has(order.status ?? '');
}

export function restaurantRevenueEuros(orders: Array<{ status?: string; total: number }>): number {
  return orders
    .filter(countsTowardRestaurantRevenue)
    .reduce((sum, order) => sum + order.total, 0);
}

/**
 * WhatOrder earnings are fees on orders that were not cancelled or rejected
 * and were not refunded. Unpaid withdrawn rows must not pick up the live
 * platform rate. A paid order keeps the fee stored at checkout.
 */
export function orderEarningsFeeEuros(order: EarningsOrder, platform: unknown): number {
  if (!countsTowardRestaurantRevenue(order)) return 0;
  if (order.paymentStatus === 'refunded' || order.settlementStatus === 'refunded') return 0;
  return displayFeeEuros(order, platform as FeeConfig);
}

export function whatorderEarningsEuros(orders: EarningsOrder[], platform: unknown): number {
  return orders.reduce((sum, order) => sum + orderEarningsFeeEuros(order, platform), 0);
}
