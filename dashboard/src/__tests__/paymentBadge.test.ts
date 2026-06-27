import { describe, it, expect } from 'vitest';
import { paymentBadge } from '../lib/paymentBadge';
import type { Order } from '../types';

const t = (key: string) => key;

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    customerId: 'c1',
    customerName: 'Test',
    customerPhone: '+431234',
    items: [],
    total: 10,
    status: 'picked_up',
    createdAt: null,
    ...overrides,
  };
}

describe('paymentBadge', () => {
  it('shows customer payment only, ignoring settlement status', () => {
    const paidPending = paymentBadge(
      order({ paymentStatus: 'paid', settlementStatus: 'pending' }),
      t,
    );
    const paidOut = paymentBadge(
      order({ paymentStatus: 'paid', settlementStatus: 'paid_out' }),
      t,
    );

    expect(paidPending.label).toBe('orders.payment.paid');
    expect(paidOut.label).toBe('orders.payment.paid');
  });

  it('maps cash, pending, and failed payment statuses', () => {
    expect(paymentBadge(order({ paymentStatus: 'cash' }), t).label).toBe('orders.payment.cash');
    expect(paymentBadge(order({ paymentStatus: 'pending' }), t).label).toBe('orders.payment.pending');
    expect(paymentBadge(order({ paymentStatus: 'failed' }), t).label).toBe('orders.payment.failed');
  });
});
