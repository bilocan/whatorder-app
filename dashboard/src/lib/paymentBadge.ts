import type { Order } from '../types';

export function paymentBadge(order: Order, t: (key: string) => string): { label: string; color: string } {
  const status = order.paymentStatus;
  if (!status || status === 'cash') return { label: t('orders.payment.cash'), color: '#6b7280' };
  if (status === 'paid') {
    if (order.settlementStatus === 'paid_out') return { label: t('orders.payment.paidOut'), color: '#16a34a' };
    if (order.settlementStatus === 'pending' || order.settlementStatus === 'included_in_payout') {
      return { label: t('orders.payment.paidPending'), color: '#22c55e' };
    }
    return { label: t('orders.payment.paid'), color: '#22c55e' };
  }
  if (status === 'pending') return { label: t('orders.payment.pending'), color: '#f59e0b' };
  if (status === 'failed') return { label: t('orders.payment.failed'), color: '#ef4444' };
  return { label: status, color: '#6b7280' };
}
