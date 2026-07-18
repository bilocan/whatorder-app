import type { DashboardT } from '../i18n';
import type { Order } from '../types';

export type PaymentBadgeKind = 'cash' | 'paid' | 'unpaid' | 'failed';

export function paymentBadge(
  order: Order,
  t: DashboardT,
): { label: string; kind: PaymentBadgeKind; color: string } {
  const status = order.paymentStatus;
  if (!status || status === 'cash') {
    return { label: t('orders.payment.cash'), kind: 'cash', color: '#d97706' };
  }
  if (status === 'paid') {
    return { label: t('orders.payment.paid'), kind: 'paid', color: '#16a34a' };
  }
  if (status === 'pending') {
    return { label: t('orders.payment.pending'), kind: 'unpaid', color: '#f59e0b' };
  }
  if (status === 'failed') {
    return { label: t('orders.payment.failed'), kind: 'failed', color: '#ef4444' };
  }
  return { label: status, kind: 'cash', color: '#d97706' };
}
