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
import {
  DEFAULT_APPROVE_ETA_MINUTES,
  getActionButtons,
  getPrimaryAction,
  postOrderAction,
} from '../lib/orderActions';
import { orderElapsed } from '../lib/orderElapsed';
import {
  ACTIVE_BOARD_COLUMNS,
  belongsToBoardDay,
  groupOrdersByColumn,
  localDayKey,
} from '../lib/orderBoardColumns';
import StatusBadge from '../components/StatusBadge';
import PaymentBadge from '../components/PaymentBadge';

const TERMINAL_STATUSES = new Set<OrderStatus>(['delivered', 'picked_up', 'rejected', 'cancelled', 'completed']);
const DAY_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function OrdersPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activePhoneNumberId = getActivePhoneNumberId();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get('filter') as 'active' | 'completed-2w' | 'completed-custom') || 'active';
  const customFrom = searchParams.get('from') ?? '';
  const customTo = searchParams.get('to') ?? '';
  const isActiveBoard = filter === 'active';
  const todayKey = localDayKey(nowMs);
  const dayParam = searchParams.get('day') ?? '';
  const selectedDay = DAY_PARAM_RE.test(dayParam) ? dayParam : todayKey;

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isActiveBoard) setOpenOrderId(null);
  }, [isActiveBoard]);

  useEffect(() => {
    setOpenOrderId(null);
  }, [selectedDay]);

  function setFilter(next: 'active' | 'completed-2w' | 'completed-custom') {
    const params = new URLSearchParams(searchParams);
    if (next === 'active') params.delete('filter');
    else params.set('filter', next);
    if (next !== 'completed-custom') {
      params.delete('from');
      params.delete('to');
    }
    if (next !== 'active') params.delete('day');
    setSearchParams(params, { replace: true });
  }

  function setBoardDay(value: string) {
    const params = new URLSearchParams(searchParams);
    if (!value || value === todayKey) params.delete('day');
    else params.set('day', value);
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
      docs.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
      setOrders(filterOrdersByPhoneRouting(docs, activePhoneNumberId));
    });
  }, [businessId, activePhoneNumberId]);

  let visibleOrders: Order[];
  if (isActiveBoard) {
    visibleOrders = orders.filter((o) => belongsToBoardDay(o, selectedDay));
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

  const grouped = groupOrdersByColumn(visibleOrders);
  const openOrder = openOrderId ? orders.find((o) => o.id === openOrderId) ?? null : null;

  function orderHref(id: string) {
    return `/orders/${id}${location.search}`;
  }

  function openOrderPage(id: string) {
    navigate(orderHref(id));
  }

  function statusLabel(status: OrderStatus | string) {
    return t(`orderDetail.status.${status}`, { defaultValue: status });
  }

  function elapsedLabel(order: Order) {
    const info = orderElapsed(toDate(order.createdAt).getTime(), order.status, nowMs);
    return {
      ...info,
      text: t(`orders.board.elapsed.${info.labelKey}`, info.labelParams),
    };
  }

  async function runAction(order: Order, action: string) {
    if (!businessId) return;
    setActionLoadingId(order.id);
    setActionError('');
    try {
      const result = await postOrderAction(businessId, order.id, action, {
        etaMinutes: DEFAULT_APPROVE_ETA_MINUTES,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      const nowIso = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id !== order.id) return o;
          const next: Order = { ...o, status: result.nextStatus };
          if (result.nextStatus === 'delivered') next.deliveredAt = nowIso;
          if (result.nextStatus === 'picked_up') next.pickedUpAt = nowIso;
          if (result.nextStatus === 'rejected') next.rejectedAt = nowIso;
          if (result.nextStatus === 'cancelled') next.cancelledAt = nowIso;
          if (result.nextStatus === 'completed') next.completedAt = nowIso;
          return next;
        }),
      );
      if (TERMINAL_STATUSES.has(result.nextStatus) && openOrderId === order.id) {
        setOpenOrderId(null);
      }
    } catch {
      setActionError(t('orderDetail.networkError'));
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div>
      <div className="orders-header">
        <h2>{isActiveBoard ? t('orders.board.title') : t('orders.title')}</h2>
        {activePhoneNumberId && (
          <p className="orders-phone-scope">{t('orders.phoneLineScope')}</p>
        )}
        <div className="orders-header-controls">
          {isActiveBoard && (
            <label className="orders-day-picker">
              <span className="orders-day-picker-label">{t('orders.filter.day')}</span>
              <input
                className="orders-date-input"
                type="date"
                value={selectedDay}
                max={todayKey}
                onChange={(e) => setBoardDay(e.target.value)}
                aria-label={t('orders.filter.day')}
              />
            </label>
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

      {visibleOrders.length === 0 && (
        <p className="orders-empty">
          {isActiveBoard ? t('orders.noOrdersForDay') : t('orders.noOrders')}
        </p>
      )}
      {actionError && <p className="order-detail-error">{actionError}</p>}

      {isActiveBoard && visibleOrders.length > 0 ? (
        <div className="kitchen-board" role="region" aria-label={t('orders.board.title')}>
          {ACTIVE_BOARD_COLUMNS.map((col) => {
            const colOrders = grouped[col.key];
            return (
              <div
                key={col.key}
                className="kitchen-column"
                style={{ ['--col-accent' as string]: col.colorToken }}
              >
                <div className="kitchen-column-header">
                  <span className="kitchen-column-label">{t(col.labelKey)}</span>
                  <span className="kitchen-column-count">{colOrders.length}</span>
                </div>
                <div className="kitchen-column-cards">
                  {colOrders.map((order) => {
                    const elapsed = elapsedLabel(order);
                    const primary = getPrimaryAction(order.status, order.orderType);
                    const pay = paymentBadge(order, t);
                    const loading = actionLoadingId === order.id;
                    return (
                      <div
                        key={order.id}
                        className={`kitchen-card${elapsed.isNew ? ' is-new' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenOrderId(order.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenOrderId(order.id);
                          }
                        }}
                      >
                        <div className="kitchen-card-top">
                          {elapsed.isNew && (
                            <span className="kitchen-new-pill">{t('orders.board.new')}</span>
                          )}
                          <span className="kitchen-card-name">{order.customerName}</span>
                          {order.orderType === 'delivery' && (
                            <span className="delivery-pill">{t('orders.delivery')}</span>
                          )}
                        </div>
                        <div className="kitchen-card-items">
                          {order.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                        </div>
                        <div className="kitchen-card-meta">
                          <span className="kitchen-card-total">€{order.total.toFixed(2)}</span>
                          <span className="kitchen-elapsed" data-urgency={elapsed.urgency}>
                            {elapsed.text}
                          </span>
                        </div>
                        <div className="kitchen-card-badges">
                          <PaymentBadge kind={pay.kind} label={pay.label} />
                          <StatusBadge status={order.status} label={statusLabel(order.status)} />
                        </div>
                        {primary && (
                          <button
                            type="button"
                            className="order-action-btn kitchen-card-action"
                            data-variant={primary.variant}
                            data-tone={primary.tone}
                            disabled={loading}
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAction(order, primary.action);
                            }}
                          >
                            {loading ? t('orderDetail.saving') : t(primary.labelKey)}
                          </button>
                        )}
                        {order.status === 'pending' && (
                          <button
                            type="button"
                            className="kitchen-reject-link"
                            disabled={loading}
                            onClick={(e) => {
                              e.stopPropagation();
                              void runAction(order, 'reject');
                            }}
                          >
                            {t('orderDetail.action.reject')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {!isActiveBoard && visibleOrders.length > 0 && (
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
                    onClick={() => openOrderPage(order.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openOrderPage(order.id);
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
      )}

      {isActiveBoard && openOrder && (
        <div
          className="kitchen-modal-backdrop"
          role="presentation"
          onClick={() => setOpenOrderId(null)}
        >
          <div
            className="kitchen-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="kitchen-modal-close"
              onClick={() => setOpenOrderId(null)}
            >
              {t('orders.board.close')}
            </button>
            <div className="order-detail-title-row">
              <h2 id="kitchen-modal-title">{openOrder.customerName}</h2>
              {openOrder.orderType === 'delivery' && (
                <span className="delivery-pill">{t('orders.delivery')}</span>
              )}
            </div>
            <p className="order-detail-id">
              #{shortId(openOrder.id)} · {openOrder.customerPhone}
            </p>
            {openOrder.orderType === 'delivery' && openOrder.deliveryAddress && (
              <p className="order-detail-address">🚚 {openOrder.deliveryAddress}</p>
            )}
            <div className="kitchen-modal-wait">
              <span>{t('orders.board.waitingSince')}</span>
              <span
                className="kitchen-elapsed"
                data-urgency={elapsedLabel(openOrder).urgency}
              >
                {elapsedLabel(openOrder).text}
              </span>
            </div>
            <table className="order-detail-table kitchen-modal-table">
              <tbody>
                {openOrder.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.qty}× {item.name}</td>
                    <td className="price">€{(item.price * item.qty).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {openOrder.orderType === 'delivery' && openOrder.deliveryFee ? (
              <p className="order-detail-fee">
                {t('orderDetail.deliveryFee', { fee: openOrder.deliveryFee.toFixed(2) })}
              </p>
            ) : null}
            <p className="order-detail-total">
              {t('orderDetail.total', { total: openOrder.total.toFixed(2) })}
            </p>
            {openOrder.notes && (
              <p className="order-detail-note">
                {t('orderDetail.note', { note: openOrder.notes })}
              </p>
            )}
            <div className="order-detail-status-row">
              <StatusBadge status={openOrder.status} label={statusLabel(openOrder.status)} />
              <PaymentBadge
                kind={paymentBadge(openOrder, t).kind}
                label={paymentBadge(openOrder, t).label}
              />
            </div>
            {getActionButtons(openOrder.status, openOrder.orderType).length > 0 && (
              <div className="order-detail-actions">
                {getActionButtons(openOrder.status, openOrder.orderType).map(
                  ({ labelKey, action, variant, tone }) => (
                    <button
                      key={action}
                      type="button"
                      className="order-action-btn"
                      data-variant={variant}
                      data-tone={tone}
                      disabled={actionLoadingId === openOrder.id}
                      onClick={() => void runAction(openOrder, action)}
                    >
                      {actionLoadingId === openOrder.id
                        ? t('orderDetail.saving')
                        : t(labelKey)}
                    </button>
                  ),
                )}
              </div>
            )}
            <Link
              className="kitchen-modal-full"
              to={orderHref(openOrder.id)}
              onClick={() => setOpenOrderId(null)}
            >
              {t('orders.board.openFull')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
