import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order, OrderStatus } from '../types';
import { toDate } from '../types';
import { paymentBadge } from '../lib/paymentBadge';
import { shortId } from '../lib/shortId';

import { API_URL } from '../lib/apiUrl';
import { authHeaders, jsonAuthHeaders } from '../lib/apiAuth';
import { matchesActivePhoneRouting } from '../lib/orderPhoneFilter';
import type { DashboardT } from '../i18n';
import StatusBadge from '../components/StatusBadge';
import PaymentBadge from '../components/PaymentBadge';

type ActionVariant = 'primary' | 'danger';
type ActionTone = 'preparing' | 'ready' | 'on_the_way' | 'delivered';
type ActionButton = {
  labelKey: string;
  action: string;
  variant?: ActionVariant;
  tone?: ActionTone;
};

function getActionButtons(status: OrderStatus, orderType?: string): ActionButton[] {
  switch (status) {
    case 'pending':
      return [
        { labelKey: 'orderDetail.action.approve', action: 'approve', variant: 'primary' },
        { labelKey: 'orderDetail.action.reject', action: 'reject', variant: 'danger' },
      ];
    case 'approved':
      return [{ labelKey: 'orderDetail.action.prepare', action: 'prepare', tone: 'preparing' }];
    case 'preparing':
      return orderType === 'delivery'
        ? [{ labelKey: 'orderDetail.action.onTheWay', action: 'on-the-way', tone: 'on_the_way' }]
        : [{ labelKey: 'orderDetail.action.markReady', action: 'ready', tone: 'ready' }];
    case 'ready':
      return [{ labelKey: 'orderDetail.action.pickedUp', action: 'picked-up', tone: 'delivered' }];
    case 'on_the_way':
      return [{ labelKey: 'orderDetail.action.delivered', action: 'delivered', tone: 'delivered' }];
    default:
      return [];
  }
}

function SettlementStatusLine({ order, t }: { order: Order; t: DashboardT }) {
  if (order.settlementStatus === 'paid_out' && order.paidAt) {
    return (
      <p className="order-detail-settlement-line ok">
        {t('orderDetail.settlement.paidOutOn', { date: new Date(order.paidAt).toLocaleDateString('de-AT') })}
      </p>
    );
  }

  if (order.settlementStatus === 'refunded') {
    return <p className="order-detail-settlement-line muted">{t('orderDetail.settlement.refunded')}</p>;
  }

  if (order.settlementStatus === 'pending' || order.settlementStatus === 'included_in_payout') {
    return (
      <>
        <p className="order-detail-settlement-line warn">{t('orderDetail.settlement.pendingPayout')}</p>
        {order.settlementEligibleAt && (
          <p className="order-detail-settlement-line quiet">
            {t('orderDetail.settlement.eligibleOn', { date: new Date(order.settlementEligibleAt).toLocaleDateString('de-AT') })}
          </p>
        )}
        {order.expectedPayoutAt && (
          <p className="order-detail-settlement-line quiet">
            {t('orderDetail.settlement.expectedPayoutOn', { date: new Date(order.expectedPayoutAt).toLocaleDateString('de-AT') })}
          </p>
        )}
      </>
    );
  }

  return null;
}

function SettlementInfo({ order, t }: { order: Order; t: DashboardT }) {
  if (order.paymentMethod !== 'stripe' || typeof order.grossAmountCents !== 'number') {
    return null;
  }

  return (
    <div className="order-detail-settlement">
      <p className="order-detail-settlement-meta">
        {t('orderDetail.settlement.gross', { amount: (order.grossAmountCents / 100).toFixed(2) })}
        {' | '}
        {t('orderDetail.settlement.fee', { amount: ((order.whatorderFeeCents ?? 0) / 100).toFixed(2) })}
        {' | '}
        {t('orderDetail.settlement.net', { amount: ((order.restaurantNetCents ?? 0) / 100).toFixed(2) })}
      </p>
      {order.paymentProcessedAt && (
        <p className="order-detail-settlement-meta">
          {t('orderDetail.settlement.paidAt', {
            time: toDate(order.paymentProcessedAt).toLocaleString('de-AT', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </p>
      )}
      <SettlementStatusLine order={order} t={t} />
    </div>
  );
}

export default function OrderDetailPage() {
  const { t } = useTranslation();
  const { orderId } = useParams<{ orderId: string }>();
  const { businessId } = useAuth();
  const location = useLocation();
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
      const headers = action === 'approve'
        ? await jsonAuthHeaders()
        : await authHeaders();
      const res = await fetch(`${API_URL}/api/businesses/${businessId}/orders/${orderId}/${action}`, {
        method: 'POST',
        headers,
        ...(action === 'approve' && {
          body: JSON.stringify({ etaMinutes }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      const nextStatus: Record<string, OrderStatus> = {
        approve: 'approved',
        reject: 'rejected',
        prepare: 'preparing',
        ready: 'ready',
        'on-the-way': 'on_the_way',
        'picked-up': 'picked_up',
        delivered: 'delivered',
        cancel: 'cancelled',
      };
      if (nextStatus[action]) setOrder((o) => (o ? { ...o, status: nextStatus[action] } : o));
    } catch {
      setActionError(t('orderDetail.networkError'));
    } finally {
      setLoading(false);
    }
  }

  const ordersListHref = `/orders${location.search}`;

  if (!orderLoaded) {
    return <p className="order-detail-loading">{t('orderDetail.loading')}</p>;
  }

  if (!order || !matchesActivePhoneRouting(order)) {
    return (
      <div className="order-detail" style={{ padding: '1rem 0' }}>
        <Link to={ordersListHref} className="order-detail-back">{t('orderDetail.back')}</Link>
        <p className="order-detail-wrong-line">{t('orderDetail.wrongPhoneLine')}</p>
      </div>
    );
  }

  const buttons = getActionButtons(order.status, order.orderType);
  const statusLabel = t(`orderDetail.status.${order.status}`, { defaultValue: order.status });
  const pay = paymentBadge(order, t);

  return (
    <div className="order-detail">
      <Link to={ordersListHref} className="order-detail-back">{t('orderDetail.back')}</Link>

      <div className="order-detail-title-row">
        <h2>{order.customerName}</h2>
        {order.orderType === 'delivery' && (
          <span className="delivery-pill">{t('orderDetail.delivery')}</span>
        )}
      </div>
      <p className="order-detail-id">#{shortId(order.id)}</p>
      <p className={`order-detail-phone${order.orderType === 'delivery' ? '' : ' spaced'}`}>
        {order.customerPhone}
      </p>
      {order.orderType === 'delivery' && order.deliveryAddress && (
        <p className="order-detail-address">🚚 {order.deliveryAddress}</p>
      )}

      <table className="order-detail-table">
        <thead>
          <tr>
            <th>{t('orderDetail.col.item')}</th>
            <th className="qty">{t('orderDetail.col.qty')}</th>
            <th className="price">{t('orderDetail.col.price')}</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={i}>
              <td>{item.name}</td>
              <td className="qty">{item.qty}</td>
              <td className="price">€{(item.price * item.qty).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.orderType === 'delivery' && order.deliveryFee ? (
        <p className="order-detail-fee">
          {t('orderDetail.deliveryFee', { fee: order.deliveryFee.toFixed(2) })}
        </p>
      ) : null}
      <p className="order-detail-total">
        {t('orderDetail.total', { total: order.total.toFixed(2) })}
      </p>

      {order.notes && (
        <p className="order-detail-note">
          {t('orderDetail.note', { note: order.notes })}
        </p>
      )}

      <p className="order-detail-ordered-at">
        {t('orderDetail.orderedAt', {
          time: toDate(order.createdAt).toLocaleString('de-AT', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
        })}
      </p>

      <div className="order-detail-status-row">
        <span className="order-detail-status-label">{t('orders.col.status')}</span>
        <StatusBadge status={order.status} label={statusLabel} />
        <PaymentBadge kind={pay.kind} label={pay.label} />
      </div>

      <SettlementInfo order={order} t={t} />

      {order.status === 'pending' && (
        <div className="order-detail-eta">
          <label htmlFor="eta-minutes">{t('orderDetail.etaLabel')}</label>
          <input
            id="eta-minutes"
            className="order-detail-eta-input"
            type="number"
            min={5}
            step={5}
            value={etaMinutes}
            onChange={(e) => setEtaMinutes(Math.max(5, Number(e.target.value) || 5))}
          />
          <span>{t('orderDetail.etaMinutesUnit')}</span>
        </div>
      )}

      {buttons.length > 0 && (
        <div className="order-detail-actions">
          {buttons.map(({ labelKey, action, variant, tone }) => (
            <button
              key={action}
              type="button"
              className="order-action-btn"
              data-variant={variant}
              data-tone={tone}
              onClick={() => doAction(action)}
              disabled={loading}
            >
              {loading ? t('orderDetail.saving') : t(labelKey)}
            </button>
          ))}
        </div>
      )}
      {actionError && <p className="order-detail-error">{actionError}</p>}
    </div>
  );
}
