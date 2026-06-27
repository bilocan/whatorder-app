import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order, OrderStatus } from '../types';
import { toDate } from '../types';
import { paymentBadge } from '../lib/paymentBadge';
import { shortId } from '../lib/shortId';
import { filterOrdersByPhoneRouting } from '../lib/orderPhoneFilter';
import { getActivePhoneNumberId } from '../lib/activePhoneNumberId';

const TERMINAL_STATUSES = new Set<OrderStatus>(['delivered', 'picked_up', 'rejected', 'cancelled', 'completed']);

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
  const activePhoneNumberId = getActivePhoneNumberId();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get('filter') as 'active' | 'completed-2w' | 'completed-custom') || 'active';
  const customFrom = searchParams.get('from') ?? '';
  const customTo = searchParams.get('to') ?? '';

  function setFilter(next: 'active' | 'completed-2w' | 'completed-custom') {
    const params = new URLSearchParams(searchParams);
    if (next === 'active') params.delete('filter');
    else params.set('filter', next);
    if (next !== 'completed-custom') {
      params.delete('from');
      params.delete('to');
    }
    setSearchParams(params, { replace: true });
  }

  function setCustomFrom(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('from', value); else params.delete('from');
    setSearchParams(params, { replace: true });
  }

  function setCustomTo(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set('to', value); else params.delete('to');
    setSearchParams(params, { replace: true });
  }

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'businesses', businessId, 'orders'),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as Order));
      // Firestore's orderBy sorts by type before value, so legacy string `createdAt`
      // values don't interleave correctly with Timestamp values — re-sort client-side.
      docs.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
      setOrders(filterOrdersByPhoneRouting(docs, activePhoneNumberId));
    });
  }, [businessId, activePhoneNumberId]);

  let visibleOrders: Order[];
  if (filter === 'active') {
    visibleOrders = orders.filter((o) => !TERMINAL_STATUSES.has(o.status));
  } else {
    const completed = orders.filter((o) => TERMINAL_STATUSES.has(o.status));
    if (filter === 'completed-2w') {
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      visibleOrders = completed.filter((o) => toDate(o.createdAt).getTime() >= cutoff);
    } else {
      const fromTime = customFrom ? new Date(customFrom).getTime() : -Infinity;
      const toTime = customTo ? new Date(customTo).getTime() + 24 * 60 * 60 * 1000 - 1 : Infinity;
      visibleOrders = completed.filter((o) => {
        const t = toDate(o.createdAt).getTime();
        return t >= fromTime && t <= toTime;
      });
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <h2>{t('orders.title')}</h2>
        {activePhoneNumberId && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#666', flexBasis: '100%' }}>{t('orders.phoneLineScope')}</p>
        )}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'active' | 'completed-2w' | 'completed-custom')}
            aria-label={t('orders.filter.label')}
            style={{
              padding: '0.35rem 2rem 0.35rem 0.6rem',
              fontSize: '0.78rem',
              color: '#555',
              background: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
              outline: 'none',
            }}
          >
            <option value="active">{t('orders.filter.active')}</option>
            <option value="completed-2w">{t('orders.filter.completed2w')}</option>
            <option value="completed-custom">{t('orders.filter.completedCustom')}</option>
          </select>
          <span style={{
            position: 'absolute',
            right: '0.5rem',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            fontSize: '0.6rem',
            color: '#999',
          }}>
            ▼
          </span>
        </div>
        {filter === 'completed-custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: '#555' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {t('orders.filter.from')}
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', border: '1px solid #e5e7eb', borderRadius: 6, outline: 'none' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {t('orders.filter.to')}
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', fontSize: '0.78rem', border: '1px solid #e5e7eb', borderRadius: 6, outline: 'none' }}
              />
            </label>
          </div>
        )}
      </div>
      {visibleOrders.length === 0 && <p style={{ color: '#999' }}>{t('orders.noOrders')}</p>}
      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.orderNumber')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.customer')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.items')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.total')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.payment')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.status')}</th>
            <th style={{ padding: '0.5rem' }}>{t('orders.col.time')}</th>
          </tr>
        </thead>
        <tbody>
          {visibleOrders.map((order) => (
            <tr key={order.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                <Link to={`/orders/${order.id}${location.search}`} style={{ color: '#666', textDecoration: 'none' }}>
                  #{shortId(order.id)}
                </Link>
              </td>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link to={`/orders/${order.id}${location.search}`} style={{ fontWeight: 600, color: '#000', textDecoration: 'none' }}>
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
                {(() => {
                  const badge = paymentBadge(order, t);
                  return (
                    <span style={{
                      background: badge.color + '22',
                      color: badge.color,
                      padding: '0.2rem 0.6rem',
                      borderRadius: 999,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}>
                      {badge.label}
                    </span>
                  );
                })()}
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
