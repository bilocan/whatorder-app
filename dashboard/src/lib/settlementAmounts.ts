import type { Order } from '../types';
import type { FeeConfig } from './feeCalc';
import { calcFee } from './feeCalc';

/** Restaurant net for settlement display — prefers stored cents, else derives from order. */
export function orderNetCents(order: Order, feeConfig?: FeeConfig): number {
  if (typeof order.restaurantNetCents === 'number') return order.restaurantNetCents;
  if (typeof order.grossAmountCents === 'number' && typeof order.whatorderFeeCents === 'number') {
    return Math.max(0, order.grossAmountCents - order.whatorderFeeCents);
  }
  if (order.paymentMethod === 'stripe' && order.paymentStatus === 'paid' && feeConfig) {
    return Math.round((order.total - calcFee(order.total, feeConfig)) * 100);
  }
  return 0;
}

export function isPendingSettlement(order: Order): boolean {
  if (order.settlementStatus === 'pending' || order.settlementStatus === 'included_in_payout') return true;
  if (order.paymentMethod === 'stripe' && order.paymentStatus === 'paid' && order.settlementStatus !== 'paid_out') {
    return true;
  }
  return false;
}
