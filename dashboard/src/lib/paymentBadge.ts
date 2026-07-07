import type { DashboardT } from '../i18n';
import type { Order } from '../types';

export function paymentBadge(order: Order, t: DashboardT): { label: string; color: string } {
  const status = order.paymentStatus;
  if (!status || status === 'cash') return { label: t('orders.payment.cash'), color: '#6b7280' };
  if (status === 'paid') return { label: t('orders.payment.paid'), color: '#22c55e' };
  if (status === 'pending') return { label: t('orders.payment.pending'), color: '#f59e0b' };
  if (status === 'failed') return { label: t('orders.payment.failed'), color: '#ef4444' };
  return { label: status, color: '#6b7280' };
}
