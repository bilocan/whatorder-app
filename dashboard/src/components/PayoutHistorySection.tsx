import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Order, Payout } from '../types';
import { toDate } from '../types';
import { formatPayoutDate } from '../lib/formatPayoutDate';
import { fetchPayoutOrders } from '../lib/fetchPayoutOrders';
import { orderNetCents } from '../lib/settlementAmounts';

type PayoutRow = Payout & { businessName?: string };

function stripeTransferUrl(transferId: string): string {
  return `https://dashboard.stripe.com/transfers/${transferId}`;
}

function stripeConnectAccountUrl(accountId: string): string {
  return `https://dashboard.stripe.com/connect/accounts/${accountId}`;
}

function PayoutReconciliation({ payout, t }: { payout: Payout; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const feeCents = payout.whatorderFeeCentsTotal ?? 0;
  const netCents = payout.totalNetCents;
  const grossCents = netCents + feeCents;

  return (
    <div style={{ padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#166534', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t('payout.reconciliation.title')}
      </div>
      <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('payout.reconciliation.gross')}</span>
          <span>€{(grossCents / 100).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e' }}>
          <span>{t('payout.reconciliation.fee')}</span>
          <span>−€{(feeCents / 100).toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #bbf7d0', paddingTop: '0.35rem' }}>
          <span>{t('payout.reconciliation.net')}</span>
          <span>€{(netCents / 100).toFixed(2)}</span>
        </div>
        {payout.stripeTransferId && (
          <div style={{ marginTop: '0.35rem' }}>
            <span style={{ color: '#666', fontSize: '0.78rem' }}>{t('payout.reconciliation.transferId')}: </span>
            <a
              href={stripeTransferUrl(payout.stripeTransferId)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#166534' }}
              onClick={(e) => e.stopPropagation()}
            >
              {payout.stripeTransferId}
            </a>
          </div>
        )}
        {payout.stripeConnectAccountId && (
          <div>
            <span style={{ color: '#666', fontSize: '0.78rem' }}>{t('payout.reconciliation.connectAccount')}: </span>
            <a
              href={stripeConnectAccountUrl(payout.stripeConnectAccountId)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#166534' }}
              onClick={(e) => e.stopPropagation()}
            >
              {payout.stripeConnectAccountId}
            </a>
          </div>
        )}
        {payout.stripeTransferId && (
          <a
            href={stripeTransferUrl(payout.stripeTransferId)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.82rem', color: '#166534', marginTop: '0.25rem', display: 'inline-block' }}
            onClick={(e) => e.stopPropagation()}
          >
            {t('payout.reconciliation.viewInStripe')} →
          </a>
        )}
      </div>
    </div>
  );
}

function PayoutOrdersList({
  payout,
  orders,
  loading,
  error,
  t,
}: {
  payout: Payout;
  orders: Order[];
  loading: boolean;
  error: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (loading) {
    return <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>{t('payout.orders.loading')}</p>;
  }
  if (error) {
    return <p style={{ color: '#b91c1c', fontSize: '0.85rem', margin: 0 }}>{error}</p>;
  }
  if (orders.length === 0) {
    return <p style={{ color: '#999', fontSize: '0.85rem', margin: 0 }}>{t('payout.orders.empty')}</p>;
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
      <thead>
        <tr style={{ textAlign: 'left', color: '#999', fontSize: '0.72rem', textTransform: 'uppercase' }}>
          <th style={{ padding: '0.35rem 0.5rem 0.35rem 0' }}>{t('payout.orders.col.customer')}</th>
          <th style={{ padding: '0.35rem 0.5rem' }}>{t('payout.orders.col.date')}</th>
          <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('payout.orders.col.net')}</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} style={{ borderTop: '1px solid #f3f4f6' }}>
            <td style={{ padding: '0.4rem 0.5rem 0.4rem 0' }}>
              <Link to={`/orders/${o.id}`} style={{ fontWeight: 600, color: 'inherit' }} onClick={(e) => e.stopPropagation()}>
                {o.customerName}
              </Link>
            </td>
            <td style={{ padding: '0.4rem 0.5rem', color: '#666', whiteSpace: 'nowrap' }}>
              {toDate(o.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </td>
            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
              €{(orderNetCents(o) / 100).toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ borderTop: '1px solid #e5e7eb' }}>
          <td colSpan={2} style={{ padding: '0.5rem 0.5rem 0 0', fontWeight: 600 }}>{t('payout.orders.total')}</td>
          <td style={{ padding: '0.5rem 0.5rem 0', textAlign: 'right', fontWeight: 700 }}>
            €{(payout.totalNetCents / 100).toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function PayoutDetailPanel({ payout }: { payout: Payout }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPayoutOrders(payout.businessId, payout.orderIds)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('payout.orders.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [payout.businessId, payout.orderIds, t]);

  return (
    <div style={{ padding: '0.75rem 0.5rem 0.5rem 0', background: '#fafafa', borderRadius: 8 }}>
      {payout.connectMode === 'live' && <PayoutReconciliation payout={payout} t={t} />}
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#666', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t('payout.orders.title', { count: payout.orderIds.length })}
      </div>
      <PayoutOrdersList payout={payout} orders={orders} loading={loading} error={error} t={t} />
    </div>
  );
}

type PayoutHistorySectionProps = {
  payouts: PayoutRow[];
  loading?: boolean;
  showRestaurantColumn?: boolean;
};

export default function PayoutHistorySection({ payouts, loading, showRestaurantColumn = false }: PayoutHistorySectionProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dataColCount = showRestaurantColumn ? 6 : 5;

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>{t('payout.history.title')}</h3>
      {loading && <p style={{ color: '#999' }}>{t('payout.history.loading')}</p>}
      {!loading && payouts.length === 0 && (
        <p style={{ color: '#999', fontSize: '0.9rem' }}>{t('payout.history.empty')}</p>
      )}
      {!loading && payouts.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', minWidth: 480 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#999', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '1px solid #eee' }}>
                <th style={{ padding: '0.5rem 0.5rem 0.5rem 0', width: 24 }} aria-hidden />
                <th style={{ padding: '0.5rem' }}>{t('payout.history.col.date')}</th>
                {showRestaurantColumn && <th style={{ padding: '0.5rem' }}>{t('payout.history.col.restaurant')}</th>}
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('payout.history.col.amount')}</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('payout.history.col.orders')}</th>
                <th style={{ padding: '0.5rem' }}>{t('payout.history.col.mode')}</th>
                <th style={{ padding: '0.5rem' }}>{t('payout.history.col.transferId')}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => {
                const expanded = expandedId === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                      style={{
                        borderBottom: expanded ? 'none' : '1px solid #f9f9f9',
                        cursor: 'pointer',
                        background: expanded ? '#fafafa' : undefined,
                      }}
                    >
                      <td style={{ padding: '0.5rem 0.5rem 0.5rem 0', color: '#999', fontSize: '0.75rem' }}>
                        {expanded ? '▼' : '▶'}
                      </td>
                      <td style={{ padding: '0.5rem', color: '#666', whiteSpace: 'nowrap' }}>
                        {formatPayoutDate(p.paidAt)}
                      </td>
                      {showRestaurantColumn && (
                        <td style={{ padding: '0.5rem', fontWeight: 600 }}>{p.businessName ?? p.businessId}</td>
                      )}
                      <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>
                        €{(p.totalNetCents / 100).toFixed(2)}
                      </td>
                      <td style={{ padding: '0.5rem', textAlign: 'right', color: '#666' }}>{p.orderIds.length}</td>
                      <td style={{ padding: '0.5rem' }}>
                        <span style={{
                          fontSize: '0.75rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 4,
                          background: p.connectMode === 'live' ? '#dcfce7' : '#f3f4f6',
                          color: p.connectMode === 'live' ? '#166534' : '#6b7280',
                        }}>
                          {p.connectMode === 'live'
                            ? t('payout.history.modeLive')
                            : t('payout.history.modeMock')}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: '#666' }}>
                        {p.stripeTransferId ?? '—'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ borderBottom: '1px solid #f9f9f9' }}>
                        <td colSpan={dataColCount + 1} style={{ padding: '0 0.5rem 0.75rem 1.5rem' }}>
                          <PayoutDetailPanel payout={p} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
