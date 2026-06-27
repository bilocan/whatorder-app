import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order, OrderStatus } from '../types';
import { toDate } from '../types';
import { paymentBadge } from '../lib/paymentBadge';
import { shortId } from '../lib/shortId';

import { API_URL } from '../lib/apiUrl';
import { matchesActivePhoneRouting } from '../lib/orderPhoneFilter';

type ActionButton = { labelKey: string; action: string; style?: React.CSSProperties };

function getActionButtons(status: OrderStatus, orderType?: string): ActionButton[] {
  switch (status) {
    case 'pending':
      return [
        { labelKey: 'orderDetail.action.approve', action: 'approve', style: { background: '#000' } },
        { labelKey: 'orderDetail.action.reject',  action: 'reject',  style: { background: '#ef4444' } },
      ];
    case 'approved':
      return [{ labelKey: 'orderDetail.action.prepare', action: 'prepare', style: { background: '#f97316' } }];
    case 'preparing':
      return orderType === 'delivery'
        ? [{ labelKey: 'orderDetail.action.onTheWay', action: 'on-the-way', style: { background: '#06b6d4' } }]
        : [{ labelKey: 'orderDetail.action.markReady', action: 'ready', style: { background: '#3b82f6' } }];
    case 'ready':
      return [{ labelKey: 'orderDetail.action.pickedUp', action: 'picked-up', style: { background: '#22c55e' } }];
    case 'on_the_way':
      return [{ labelKey: 'orderDetail.action.delivered', action: 'delivered', style: { background: '#22c55e' } }];
    default:
      return [];
  }
}

const STATUS_COLOR: Record<string, string> = {
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

function SettlementStatusLine({ order, t }: { order: Order; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (order.settlementStatus === 'paid_out' && order.paidAt) {
    return (
      <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>
        {t('orderDetail.settlement.paidOutOn', { date: new Date(order.paidAt).toLocaleDateString('de-AT') })}
      </p>
    );
  }

  if (order.settlementStatus === 'refunded') {
    return <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>{t('orderDetail.settlement.refunded')}</p>;
  }

  if (order.settlementStatus === 'pending' || order.settlementStatus === 'included_in_payout') {
    return (
      <>
        <p style={{ color: '#d97706', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>{t('orderDetail.settlement.pendingPayout')}</p>
        {order.settlementEligibleAt && (
          <p style={{ color: '#999', fontSize: '0.8rem', margin: '0.2rem 0 0' }}>
            {t('orderDetail.settlement.eligibleOn', { date: new Date(order.settlementEligibleAt).toLocaleDateString('de-AT') })}
          </p>
        )}
      </>
    );
  }

  return null;
}

function SettlementInfo({ order, t }: { order: Order; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const badge = paymentBadge(order, t);

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <span style={{ background: badge.color + '22', color: badge.color, padding: '0.2rem 0.6rem', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600 }}>
        {badge.label}
      </span>

      {order.paymentMethod === 'stripe' && typeof order.grossAmountCents === 'number' && (
        <>
          <p style={{ color: '#999', fontSize: '0.8rem', margin: '0.4rem 0 0' }}>
            {t('orderDetail.settlement.gross', { amount: (order.grossAmountCents / 100).toFixed(2) })}
            {' | '}
            {t('orderDetail.settlement.fee', { amount: ((order.whatorderFeeCents ?? 0) / 100).toFixed(2) })}
            {' | '}
            {t('orderDetail.settlement.net', { amount: ((order.restaurantNetCents ?? 0) / 100).toFixed(2) })}
          </p>
          {order.paymentProcessedAt && (
            <p style={{ color: '#999', fontSize: '0.8rem', margin: '0.2rem 0 0' }}>
              {t('orderDetail.settlement.paidAt', {
                time: toDate(order.paymentProcessedAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
              })}
            </p>
          )}
          <SettlementStatusLine order={order} t={t} />
        </>
      )}
    </div>
  );
}

export default function OrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams<{ orderId: string }>();
  const { businessId } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(false);
  const [etaMinutes, setEtaMinutes] = useState(30);

  useEffect(() => {
    if (!orderId || !businessId) return;
    setOrderLoaded(false);
    getDoc(doc(db, 'businesses', businessId, 'orders', orderId)).then((snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } as Order);
      else setOrder(null);
      setOrderLoaded(true);
    });
  }, [orderId, businessId]);

  async function doAction(action: string) {
    if (!orderId || !order || !businessId) return;
    setLoading(true);
    setActionError('');
    try {
      const res = await fetch(`${API_URL}/api/businesses/${businessId}/orders/${orderId}/${action}`, {
        method: 'POST',
        ...(action === 'approve' && {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etaMinutes }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      const nextStatus: Record<string, OrderStatus> = {
        approve:      'approved',
        reject:       'rejected',
        prepare:      'preparing',
        ready:        'ready',
        'on-the-way': 'on_the_way',
        'picked-up':  'picked_up',
        delivered:    'delivered',
        cancel:       'cancelled',
      };
      if (nextStatus[action]) setOrder((o) => o ? { ...o, status: nextStatus[action] } : o);
    } catch {
      setActionError(t('orderDetail.networkError'));
    } finally {
      setLoading(false);
    }
  }

  if (!orderLoaded) return <p style={{ padding: '1rem' }}>{t('orderDetail.loading')}</p>;

  if (!order || !matchesActivePhoneRouting(order)) {
    return (
      <div style={{ maxWidth: 480, padding: '1rem 0' }}>
        <Link to="/orders" style={{ fontSize: '0.9rem', color: '#666', textDecoration: 'none' }}>{t('orderDetail.back')}</Link>
        <p style={{ color: '#666', marginTop: '1rem' }}>{t('orderDetail.wrongPhoneLine')}</p>
      </div>
    );
  }

  const buttons = getActionButtons(order.status, order.orderType);
  const color = STATUS_COLOR[order.status] ?? '#999';

  return (
    <div style={{ maxWidth: 480 }}>
      <Link to="/orders" style={{ fontSize: '0.9rem', color: '#666', textDecoration: 'none' }}>{t('orderDetail.back')}</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', marginBottom: '0.1rem' }}>
        <h2 style={{ margin: 0 }}>{order.customerName}</h2>
        {order.orderType === 'delivery' && (
          <span style={{ background: '#0ea5e922', color: '#0ea5e9', padding: '0.15rem 0.6rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.02em' }}>
            {t('orderDetail.delivery')}
          </span>
        )}
      </div>
      <p style={{ color: '#999', margin: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>#{shortId(order.id)}</p>
      <p style={{ color: '#999', margin: 0, marginBottom: order.orderType === 'delivery' ? '0.25rem' : '1.5rem' }}>{order.customerPhone}</p>
      {order.orderType === 'delivery' && order.deliveryAddress && (
        <p style={{ color: '#0ea5e9', fontSize: '0.85rem', margin: '0 0 1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.25rem' }}>
          🚚 {order.deliveryAddress}
        </p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '0.4rem 0' }}>{t('orderDetail.col.item')}</th>
            <th style={{ padding: '0.4rem' }}>{t('orderDetail.col.qty')}</th>
            <th style={{ padding: '0.4rem', textAlign: 'right' }}>{t('orderDetail.col.price')}</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.5rem 0' }}>{item.name}</td>
              <td style={{ padding: '0.5rem' }}>{item.qty}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>€{(item.price * item.qty).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.orderType === 'delivery' && order.deliveryFee ? (
        <p style={{ fontSize: '0.85rem', color: '#999', textAlign: 'right', margin: '0.25rem 0 0' }}>
          {t('orderDetail.deliveryFee', { fee: order.deliveryFee.toFixed(2) })}
        </p>
      ) : null}
      <p style={{ fontWeight: 700, fontSize: '1.1rem', textAlign: 'right' }}>
        {t('orderDetail.total', { total: order.total.toFixed(2) })}
      </p>

      {order.notes && (
        <p style={{ color: '#666', background: '#fafafa', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.9rem' }}>
          {t('orderDetail.note', { note: order.notes })}
        </p>
      )}

      <p style={{ color: '#999', fontSize: '0.85rem' }}>
        {t('orderDetail.orderedAt', { time: toDate(order.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) })}
      </p>

      <p style={{ fontWeight: 600, color }}>
        {t(`orderDetail.status.${order.status}`, { defaultValue: order.status })}
      </p>

      <SettlementInfo order={order} t={t} />

      {order.status === 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
          <label htmlFor="eta-minutes" style={{ fontSize: '0.85rem', color: '#666' }}>{t('orderDetail.etaLabel')}</label>
          <input
            id="eta-minutes"
            type="number"
            min={5}
            step={5}
            value={etaMinutes}
            onChange={(e) => setEtaMinutes(Math.max(5, Number(e.target.value) || 5))}
            style={{ width: 64, padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #ddd' }}
          />
          <span style={{ fontSize: '0.85rem', color: '#666' }}>{t('orderDetail.etaMinutesUnit')}</span>
        </div>
      )}

      {buttons.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {buttons.map(({ labelKey, action, style }) => (
            <button
              key={action}
              onClick={() => doAction(action)}
              disabled={loading}
              style={{
                padding: '0.7rem 1.5rem',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'default' : 'pointer',
                fontWeight: 600,
                fontSize: '0.95rem',
                opacity: loading ? 0.6 : 1,
                ...style,
              }}
            >
              {loading ? t('orderDetail.saving') : t(labelKey)}
            </button>
          ))}
        </div>
      )}
      {actionError && (
        <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{actionError}</p>
      )}
    </div>
  );
}
