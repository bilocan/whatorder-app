import { displayFeeEuros, resolveEffectiveFee, type FeeConfig } from './feeCalc';

type EarningsOrder = {
  status?: string;
  total: number;
  paymentMethod?: string;
  paymentStatus?: string;
  settlementStatus?: string;
  whatorderFeeCents?: number;
  restaurantFee?: unknown;
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
 * and were not refunded. A paid order keeps the fee stored at checkout.
 * An unpaid card order uses the restaurant rate when one is set.
 */
export function orderEarningsFeeEuros(order: EarningsOrder, platform: unknown): number {
  if (!countsTowardRestaurantRevenue(order)) return 0;
  if (order.paymentStatus === 'refunded' || order.settlementStatus === 'refunded') return 0;
  return displayFeeEuros(order, platform as FeeConfig, {
    applyRestaurantFee: true,
    restaurantOverride: order.restaurantFee,
  });
}

export function whatorderEarningsEuros(orders: EarningsOrder[], platform: unknown): number {
  return orders.reduce((sum, order) => sum + orderEarningsFeeEuros(order, platform), 0);
}

export type EarningsBucket = { count: number; euros: number };

const EMPTY_BUCKET: EarningsBucket = { count: 0, euros: 0 };

function addToBucket(bucket: EarningsBucket, total: number): EarningsBucket {
  return { count: bucket.count + 1, euros: bucket.euros + total };
}

/** Full order total, plus cancelled, rejected, and the kept remainder. */
export function earningsStatusSplit(orders: Array<{ status?: string; total: number }>): {
  all: EarningsBucket;
  cancelled: EarningsBucket;
  rejected: EarningsBucket;
  kept: EarningsBucket;
} {
  let all = { ...EMPTY_BUCKET };
  let cancelled = { ...EMPTY_BUCKET };
  let rejected = { ...EMPTY_BUCKET };
  let kept = { ...EMPTY_BUCKET };
  for (const order of orders) {
    all = addToBucket(all, order.total);
    if (order.status === 'cancelled') cancelled = addToBucket(cancelled, order.total);
    else if (order.status === 'rejected') rejected = addToBucket(rejected, order.total);
    else kept = addToBucket(kept, order.total);
  }
  return { all, cancelled, rejected, kept };
}

export type FeeRateBucket = {
  feeType: 'percent' | 'fixed';
  feeValue: number;
  count: number;
  euros: number;
};

/**
 * Kept orders only, grouped by the fee that applies today:
 * the restaurant override when it is valid, otherwise the platform fee.
 * Cancelled and rejected orders stay on the status cards.
 */
export function earningsByFeeRate(
  orders: Array<{ status?: string; total: number; restaurantFee?: unknown }>,
  platform: unknown,
): FeeRateBucket[] {
  const map = new Map<string, FeeRateBucket>();
  for (const order of orders) {
    if (!countsTowardRestaurantRevenue(order)) continue;
    const fee = resolveEffectiveFee(platform, order.restaurantFee);
    const key = `${fee.feeType}:${fee.feeValue}`;
    const current = map.get(key) ?? { feeType: fee.feeType, feeValue: fee.feeValue, count: 0, euros: 0 };
    current.count += 1;
    current.euros += order.total;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => {
    if (a.feeType !== b.feeType) return a.feeType === 'percent' ? -1 : 1;
    return a.feeValue - b.feeValue;
  });
}

export function feeRateLabel(bucket: Pick<FeeRateBucket, 'feeType' | 'feeValue'>): string {
  if (bucket.feeType === 'percent') return `${bucket.feeValue}%`;
  return `€${bucket.feeValue.toFixed(2)}`;
}
