import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFeeConfig, calcFee } from '../hooks/useFeeConfig';
import type { Order } from '../types';
import { toDate } from '../types';

export default function IncomePage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const feeConfig = useFeeConfig();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!businessId) return;
    getDocs(collection(db, 'businesses', businessId, 'orders')).then((snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as Order)));
    });
  }, [businessId]);

  const [period, setPeriod] = useState<'today' | 'week'>('today');

  const today = new Date().toDateString();
  const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const periodOrders = orders.filter((o) => {
    const created = toDate(o.createdAt);
    return period === 'today' ? created.toDateString() === today : created.getTime() >= weekCutoff;
  });
  const EARNED_STATUSES = new Set(['completed', 'picked_up', 'delivered']);
  const earned = periodOrders.filter((o) => EARNED_STATUSES.has(o.status)).reduce((s, o) => s + o.total, 0);
  const pending = periodOrders.filter((o) => !EARNED_STATUSES.has(o.status)).reduce((s, o) => s + o.total, 0);
  const totalFee = periodOrders.reduce((s, o) => s + calcFee(o.total, feeConfig), 0);

  const cards = [
    { label: t('income.earned'),      value: `€${earned.toFixed(2)}` },
    { label: t('income.pending'),     value: `€${pending.toFixed(2)}` },
    { label: t('income.orders'),      value: String(periodOrders.length) },
    { label: t('income.whatorderFee'), value: `€${totalFee.toFixed(2)}`, accent: true },
  ];

  const totalRevenue = periodOrders.reduce((s, o) => s + o.total, 0);
  const cardPaid = periodOrders.filter((o) => o.paymentMethod === 'stripe' && o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0);
  // Everything not yet confirmed paid by card: actual cash orders + stripe orders still pending/failed.
  const cashPending = totalRevenue - cardPaid;
  const cardPct = totalRevenue ? (cardPaid / totalRevenue) * 100 : 0;
  const cashPct = totalRevenue ? (cashPending / totalRevenue) * 100 : 0;
  const refunds = periodOrders.filter((o) => o.paymentStatus === 'refunded').reduce((s, o) => s + o.total, 0);
  const stripeAttempts = periodOrders.filter((o) => o.paymentMethod === 'stripe');
  const failedAttempts = stripeAttempts.filter((o) => o.paymentStatus === 'failed').length;
  const failureRate = stripeAttempts.length ? (failedAttempts / stripeAttempts.length) * 100 : 0;

  return (
    <div>
      <h2>{t(period === 'today' ? 'income.titleToday' : 'income.titleWeek')}</h2>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {(['today', 'week'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: '0.4rem 0.9rem',
              borderRadius: 999,
              border: `1px solid ${period === p ? '#6366f1' : '#ddd'}`,
              background: period === p ? '#6366f1' : 'transparent',
              color: period === p ? '#fff' : 'inherit',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {t(p === 'today' ? 'income.periodToday' : 'income.periodWeek')}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {cards.map(({ label, value, accent }) => (
          <div key={label} style={{ padding: '1rem 1.5rem', border: `1px solid ${accent ? '#6366f1' : '#eee'}`, borderRadius: 10, minWidth: 120 }}>
            <div style={{ fontSize: '0.75rem', color: accent ? '#6366f1' : '#999', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: accent ? '#6366f1' : 'inherit' }}>{value}</div>
          </div>
        ))}
      </div>

      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>{t('income.analyticsTitle')}</h3>
      <div style={{ padding: '1rem 1.5rem', border: '1px solid #eee', borderRadius: 10, marginBottom: '2rem', maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span>{t('income.totalRevenue')}</span>
          <span style={{ fontWeight: 700 }}>€{totalRevenue.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '1rem', color: '#22c55e' }}>
          <span>{t('income.paidCard')}</span>
          <span>€{cardPaid.toFixed(2)} ({cardPct.toFixed(0)}%)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: '1rem', color: '#6b7280', marginBottom: '0.5rem' }}>
          <span>{t('income.cashPending')}</span>
          <span>€{cashPending.toFixed(2)} ({cashPct.toFixed(0)}%)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
          <span>{t('income.recentRefunds')}</span>
          <span>€{refunds.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('income.failureRate')}</span>
          <span>{failureRate.toFixed(1)}%</span>
        </div>
      </div>

      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>{t('income.breakdown')}</h3>
      {periodOrders.length === 0 && <p style={{ color: '#999' }}>{t('income.noOrders')}</p>}
      {periodOrders.map((order) => (
        <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f9f9f9' }}>
          <div>
            <span style={{ fontWeight: 600 }}>{order.customerName}</span>
            <span style={{ color: '#999', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              {toDate(order.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span>€{order.total.toFixed(2)}</span>
            <span style={{ fontSize: '0.8rem', color: '#6366f1' }}>
              {t('income.feeLabel', { fee: calcFee(order.total, feeConfig).toFixed(2) })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
