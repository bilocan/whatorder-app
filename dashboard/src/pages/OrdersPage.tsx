import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order } from '../types';
import { toDate } from '../types';

const statusColor: Record<string, string> = {
  pending:    '#f59e0b',
  approved:   '#a855f7',
  preparing:  '#f97316',
  ready:      '#3b82f6',
  on_the_way: '#06b6d4',
  picked_up:  '#22c55e',
  delivered:  '#22c55e',
  rejected:   '#ef4444',
  cancelled:  '#6b7280',
  completed:  '#22c55e',
};

export default function OrdersPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'businesses', businessId, 'orders'),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as Order)));
    });
  }, [businessId]);

  return (
    <div>
      <h2>{t('orders.title')}</h2>
      {orders.length === 0 && <p style={{ color: '#999' }}>{t('orders.noOrders')}</p>}
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.customer')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.items')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.total')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.status')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.time')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link to={`/orders/${order.id}`} style={{ fontWeight: 600, color: '#000', textDecoration: 'none' }}>
                    {order.customerName}
                  </Link>
                  {order.orderType === 'delivery' && (
                    <span style={{ background: '#0ea5e922', color: '#0ea5e9', padding: '0.1rem 0.5rem', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.02em' }}>
                      {t('orders.delivery')}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#999' }}>{order.customerPhone}</div>
                {order.orderType === 'delivery' && order.deliveryAddress && (
                  <div style={{ fontSize: '0.75rem', color: '#0ea5e9', marginTop: '0.1rem' }}>
                    🚚 {order.deliveryAddress}
                  </div>
                )}
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem' }}>
                {order.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>
                €{order.total.toFixed(2)}
                {order.orderType === 'delivery' && order.deliveryFee ? (
                  <div style={{ fontSize: '0.72rem', color: '#999', fontWeight: 400 }}>
                    {t('orders.deliveryFee', { fee: order.deliveryFee.toFixed(2) })}
                  </div>
                ) : null}
              </td>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <span style={{
                  background: statusColor[order.status] + '22',
                  color: statusColor[order.status],
                  padding: '0.2rem 0.6rem',
                  borderRadius: 999,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}>
                  {order.status}
                </span>
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.85rem', color: '#666' }}>
                {toDate(order.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
