import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order, OrderStatus } from '../types';
import { toDate } from '../types';
import { paymentBadge } from '../lib/paymentBadge';
import { shortId } from '../lib/shortId';
import { filterOrdersByPhoneRouting } from '../lib/orderPhoneFilter';
import { getActivePhoneNumberId } from '../lib/activePhoneNumberId';
import StatusBadge from '../components/StatusBadge';
import PaymentBadge from '../components/PaymentBadge';

const TERMINAL_STATUSES = new Set<OrderStatus>(['delivered', 'picked_up', 'rejected', 'cancelled', 'completed']);

export default function OrdersPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const navigate = useNavigate();
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
        const created = toDate(o.createdAt).getTime();
        return created >= fromTime && created <= toTime;
      });
    }
  }

  function orderHref(id: string) {
    return `/orders/${id}${location.search}`;
  }

  function openOrder(id: string) {
    navigate(orderHref(id));
  }

  function statusLabel(status: OrderStatus | string) {
    return t(`orderDetail.status.${status}`, { defaultValue: status });
  }

  return (
    <div>
      <div className="orders-header">
        <h2>{t('orders.title')}</h2>
        {activePhoneNumberId && (
          <p className="orders-phone-scope">{t('orders.phoneLineScope')}</p>
        )}
        <div className="orders-filter-wrap">
          <select
            className="orders-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'active' | 'completed-2w' | 'completed-custom')}
            aria-label={t('orders.filter.label')}
          >
            <option value="active">{t('orders.filter.active')}</option>
            <option value="completed-2w">{t('orders.filter.completed2w')}</option>
            <option value="completed-custom">{t('orders.filter.completedCustom')}</option>
          </select>
          <span className="orders-filter-chevron" aria-hidden>▼</span>
        </div>
        {filter === 'completed-custom' && (
          <div className="orders-date-range">
            <label>
              {t('orders.filter.from')}
              <input
                className="orders-date-input"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label>
              {t('orders.filter.to')}
              <input
                className="orders-date-input"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>
      {visibleOrders.length === 0 && <p className="orders-empty">{t('orders.noOrders')}</p>}
      <div className="orders-table-wrap">
        <table className="orders-table">
          <thead>
            <tr>
              <th>{t('orders.col.orderNumber')}</th>
              <th>{t('orders.col.customer')}</th>
              <th>{t('orders.col.items')}</th>
              <th>{t('orders.col.total')}</th>
              <th>{t('orders.col.payment')}</th>
              <th>{t('orders.col.status')}</th>
              <th>{t('orders.col.time')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleOrders.map((order) => {
              const pay = paymentBadge(order, t);
              return (
                <tr
                  key={order.id}
                  className="orders-row"
                  tabIndex={0}
                  onClick={() => openOrder(order.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openOrder(order.id);
                    }
                  }}
                >
                  <td>
                    <Link
                      className="orders-id"
                      to={orderHref(order.id)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      #{shortId(order.id)}
                    </Link>
                  </td>
                  <td>
                    <div className="orders-customer-meta">
                      <Link
                        className="orders-customer-name"
                        to={orderHref(order.id)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {order.customerName}
                      </Link>
                      {order.orderType === 'delivery' && (
                        <span className="delivery-pill">{t('orders.delivery')}</span>
                      )}
                    </div>
                    <div className="orders-phone">{order.customerPhone}</div>
                    {order.orderType === 'delivery' && order.deliveryAddress && (
                      <div className="orders-address">
                        🚚 {order.deliveryAddress}
                      </div>
                    )}
                  </td>
                  <td className="orders-items">
                    {order.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}
                  </td>
                  <td className="orders-total">
                    €{order.total.toFixed(2)}
                    {order.orderType === 'delivery' && order.deliveryFee ? (
                      <div className="orders-fee">
                        {t('orders.deliveryFee', { fee: order.deliveryFee.toFixed(2) })}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <PaymentBadge kind={pay.kind} label={pay.label} />
                  </td>
                  <td>
                    <StatusBadge status={order.status} label={statusLabel(order.status)} />
                  </td>
                  <td className="orders-time">
                    {toDate(order.createdAt).toLocaleString('de-AT', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
