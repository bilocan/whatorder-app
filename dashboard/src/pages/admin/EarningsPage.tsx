import { useEffect, useState } from 'react';
import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../../lib/firebase';
import { useFeeConfig, calcFee } from '../../hooks/useFeeConfig';
import type { FeeConfig } from '../../hooks/useFeeConfig';
import type { Order, Business, Payout } from '../../types';
import { toDate } from '../../types';
import { filterOrdersByPhoneRouting } from '../../lib/orderPhoneFilter';
import { useAdminPhoneLine } from '../../contexts/AdminPhoneLineContext';
import { API_URL } from '../../lib/apiUrl';
import { auth } from '../../lib/firebase';
import { orderNetCents, isPendingSettlement } from '../../lib/settlementAmounts';
import { fetchAllOrderDocs } from '../../lib/fetchAllOrders';

type PayoutRunSummary = {
  batchesPaid?: number;
  skippedBelowMinimum?: number;
  skippedConnect?: number;
};

type PayoutRunResponse = {
  payouts?: Array<{ status: string; businessId?: string; totalNetCents?: number; orderCount?: number }>;
  summary?: PayoutRunSummary;
  eligibleOrderCount?: number;
  holdBlockedCount?: number;
  ignoreHold?: boolean;
};

function formatPayoutResult(data: PayoutRunResponse, dryRun: boolean, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const summary = data.summary ?? {};
  const paid = summary.batchesPaid ?? 0;
  const lines: string[] = [
    dryRun
      ? t('admin.earnings.payout.previewResult', { count: paid })
      : t('admin.earnings.payout.runResult', { count: paid }),
  ];
  if (typeof data.eligibleOrderCount === 'number') {
    lines.push(t('admin.earnings.payout.eligibleOrders', { count: data.eligibleOrderCount }));
  }
  if (data.holdBlockedCount && data.holdBlockedCount > 0) {
    lines.push(t('admin.earnings.payout.holdBlocked', { count: data.holdBlockedCount }));
  }
  if (summary.skippedBelowMinimum && summary.skippedBelowMinimum > 0) {
    lines.push(t('admin.earnings.payout.skippedMinimum', { count: summary.skippedBelowMinimum }));
  }
  if (summary.skippedConnect && summary.skippedConnect > 0) {
    lines.push(t('admin.earnings.payout.skippedConnect', { count: summary.skippedConnect }));
  }
  if (paid === 0 && (data.eligibleOrderCount ?? 0) === 0 && !data.ignoreHold && (data.holdBlockedCount ?? 0) > 0) {
    lines.push(t('admin.earnings.payout.allInHold'));
  }
  if (paid === 0 && (data.payouts ?? []).length === 0 && (data.eligibleOrderCount ?? 0) === 0) {
    lines.push(t('admin.earnings.payout.noPending'));
  }
  return lines.join('\n');
}

type OrderRow = Order & { businessId: string; businessName: string };

function settlementStatusKey(status: Order['settlementStatus']): string {
  if (!status || status === 'none') return 'none';
  return status;
}

function formatPayoutDate(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function EarningsPage() {
  const { t } = useTranslation();
  const feeConfig = useFeeConfig();
  const { phoneNumberId } = useAdminPhoneLine();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [payoutHistory, setPayoutHistory] = useState<Array<Payout & { businessName: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [editType, setEditType] = useState<FeeConfig['feeType']>(feeConfig.feeType);
  const [editValue, setEditValue] = useState(String(feeConfig.feeValue));
  const [saving, setSaving] = useState(false);
  const [payoutDryRun, setPayoutDryRun] = useState(true);
  const [payoutRunning, setPayoutRunning] = useState(false);
  const [payoutResult, setPayoutResult] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setEditType(feeConfig.feeType);
    setEditValue(String(feeConfig.feeValue));
  }, [feeConfig]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [businessSnap, orderDocs, payoutSnap, routingSnap] = await Promise.all([
          getDocs(collection(db, 'businesses')),
          fetchAllOrderDocs(),
          getDocs(collection(db, 'payouts')),
          phoneNumberId ? getDoc(doc(db, 'phoneRouting', phoneNumberId)) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const businessIdsOnLine = new Set<string>(
          routingSnap?.exists() ? (routingSnap.data().businessIds ?? []) : [],
        );

        const nameMap = new Map<string, string>();
        businessSnap.docs.forEach((d) => {
          const b = d.data() as Business;
          nameMap.set(d.id, b.name ?? d.id);
        });

        const rows: OrderRow[] = orderDocs.map((d) => {
          const businessId = d.ref.parent.parent?.id ?? '';
          return {
            id: d.id,
            businessId,
            businessName: nameMap.get(businessId) ?? businessId,
            ...(d.data({ serverTimestamps: 'estimate' }) as Omit<Order, 'id'>),
          };
        });

        rows.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
        setOrders(filterOrdersByPhoneRouting(rows, phoneNumberId));

        const payouts = payoutSnap.docs
          .map((d) => ({
            id: d.id,
            businessName: nameMap.get(d.data().businessId as string) ?? d.data().businessId,
            ...(d.data() as Omit<Payout, 'id'>),
          }))
          .filter((p) => !phoneNumberId || businessIdsOnLine.has(p.businessId))
          .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
        setPayoutHistory(payouts);
      } catch (err) {
        if (!cancelled) {
          console.error('[EarningsPage] fetch failed', err);
          setLoadError(err instanceof Error ? err.message : t('admin.earnings.loadError'));
          setOrders([]);
          setPayoutHistory([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [phoneNumberId, reloadKey, t]);

  async function saveFeeConfig() {
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    await setDoc(doc(db, 'config', 'whatorder'), { feeType: editType, feeValue: val });
    setSaving(false);
  }

  async function runPayoutBatch() {
    setPayoutRunning(true);
    setPayoutResult(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${API_URL}/admin/payouts/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dryRun: payoutDryRun }),
      });
      const data = await res.json() as PayoutRunResponse;
      if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
      setPayoutResult(formatPayoutResult(data, payoutDryRun, t));
      if (!payoutDryRun) setReloadKey((k) => k + 1);
    } catch (err) {
      setPayoutResult(err instanceof Error ? err.message : t('admin.earnings.payout.failed'));
    } finally {
      setPayoutRunning(false);
    }
  }

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const totalFees = orders.reduce((s, o) => s + calcFee(o.total, feeConfig), 0);

  const pendingSettlementCents = orders
    .filter((o) => isPendingSettlement(o))
    .reduce((s, o) => s + orderNetCents(o, feeConfig), 0);
  const paidOutCents = orders
    .filter((o) => o.settlementStatus === 'paid_out')
    .reduce((s, o) => s + orderNetCents(o, feeConfig), 0);
  const refundedCount = orders.filter((o) => o.settlementStatus === 'refunded').length;

  const pendingByRestaurant = new Map<string, number>();
  orders
    .filter((o) => isPendingSettlement(o))
    .forEach((o) => {
      pendingByRestaurant.set(o.businessName, (pendingByRestaurant.get(o.businessName) ?? 0) + orderNetCents(o, feeConfig));
    });

  const cardStyle: React.CSSProperties = {
    padding: '1rem 1.5rem',
    border: '1px solid #eee',
    borderRadius: 10,
    minWidth: 150,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    color: '#999',
    marginBottom: '0.3rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
  const valueStyle: React.CSSProperties = { fontSize: '1.75rem', fontWeight: 700 };

  return (
    <div>
      <h2>{t('admin.earnings.title')}</h2>
      {phoneNumberId && (
        <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: '#666' }}>{t('admin.earnings.phoneLineScope')}</p>
      )}
      {loadError && (
        <p style={{ margin: '0 0 1rem', padding: '0.75rem', background: '#fef2f2', color: '#b91c1c', borderRadius: 8, fontSize: '0.85rem' }}>
          {loadError}
        </p>
      )}

      {/* Fee config editor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.85rem', color: '#666' }}>{t('admin.earnings.feeModel')}</span>
        <select
          value={editType}
          onChange={(e) => setEditType(e.target.value as FeeConfig['feeType'])}
          style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #ddd' }}
        >
          <option value="fixed">{t('admin.earnings.feeFixed')}</option>
          <option value="percent">{t('admin.earnings.feePercent')}</option>
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          style={{ width: 90, padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #ddd' }}
        />
        {editType === 'percent' && <span style={{ fontSize: '0.85rem', color: '#666' }}>%</span>}
        {editType === 'fixed' && <span style={{ fontSize: '0.85rem', color: '#666' }}>€</span>}
        <button
          onClick={saveFeeConfig}
          disabled={saving}
          style={{ padding: '0.3rem 0.9rem', borderRadius: 6, background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          {saving ? t('admin.earnings.saving') : t('admin.earnings.save')}
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={labelStyle}>{t('admin.earnings.cards.totalOrders')}</div>
          <div style={valueStyle}>{orders.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>{t('admin.earnings.cards.restaurantRevenue')}</div>
          <div style={valueStyle}>€{totalRevenue.toFixed(2)}</div>
        </div>
        <div style={{ ...cardStyle, borderColor: '#6366f1' }}>
          <div style={{ ...labelStyle, color: '#6366f1' }}>{t('admin.earnings.cards.whatorderEarnings')}</div>
          <div style={{ ...valueStyle, color: '#6366f1' }}>€{totalFees.toFixed(2)}</div>
        </div>
      </div>

      {/* Settlement / payout status */}
      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>{t('admin.earnings.settlement.title')}</h3>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={cardStyle}>
          <div style={labelStyle}>{t('admin.earnings.settlement.pending')}</div>
          <div style={valueStyle}>€{(pendingSettlementCents / 100).toFixed(2)}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>{t('admin.earnings.settlement.paidOut')}</div>
          <div style={valueStyle}>€{(paidOutCents / 100).toFixed(2)}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>{t('admin.earnings.settlement.refunded')}</div>
          <div style={valueStyle}>{refundedCount}</div>
        </div>
      </div>
      {pendingByRestaurant.size > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ ...labelStyle, marginBottom: '0.5rem' }}>{t('admin.earnings.settlement.byRestaurant')}</div>
          {[...pendingByRestaurant.entries()].map(([name, cents]) => (
            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: '0.9rem', borderBottom: '1px solid #f9f9f9' }}>
              <span>{name}</span>
              <span style={{ fontWeight: 600 }}>€{(cents / 100).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #eee', borderRadius: 10 }}>
        <div style={{ ...labelStyle, marginBottom: '0.5rem' }}>{t('admin.earnings.payout.title')}</div>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#666' }}>{t('admin.earnings.payout.hint')}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <input type="checkbox" checked={payoutDryRun} onChange={(e) => setPayoutDryRun(e.target.checked)} />
          {t('admin.earnings.payout.dryRun')}
        </label>
        <button
          type="button"
          onClick={runPayoutBatch}
          disabled={payoutRunning}
          style={{ padding: '0.4rem 1rem', borderRadius: 6, background: '#000', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          {payoutRunning ? t('admin.earnings.payout.running') : t('admin.earnings.payout.run')}
        </button>
        {payoutResult && (
          <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem', color: '#444', whiteSpace: 'pre-line' }}>{payoutResult}</p>
        )}
      </div>

      {/* Payout history */}
      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>{t('admin.earnings.payoutHistory.title')}</h3>
      {loading && <p style={{ color: '#999' }}>{t('admin.earnings.loading')}</p>}
      {!loading && payoutHistory.length === 0 && (
        <p style={{ color: '#999', marginBottom: '2rem', fontSize: '0.9rem' }}>{t('admin.earnings.payoutHistory.empty')}</p>
      )}
      {!loading && payoutHistory.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: '2rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#999', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '1px solid #eee' }}>
              <th style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>{t('admin.earnings.payoutHistory.col.date')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.payoutHistory.col.restaurant')}</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('admin.earnings.payoutHistory.col.amount')}</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('admin.earnings.payoutHistory.col.orders')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.payoutHistory.col.mode')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.payoutHistory.col.transferId')}</th>
            </tr>
          </thead>
          <tbody>
            {payoutHistory.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f9f9f9' }}>
                <td style={{ padding: '0.5rem 0.5rem 0.5rem 0', color: '#666', whiteSpace: 'nowrap' }}>
                  {formatPayoutDate(p.paidAt)}
                </td>
                <td style={{ padding: '0.5rem', fontWeight: 600 }}>{p.businessName}</td>
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
                      ? t('admin.earnings.payoutHistory.modeLive')
                      : t('admin.earnings.payoutHistory.modeMock')}
                  </span>
                </td>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: '#666' }}>
                  {p.stripeTransferId ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Orders table */}
      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>{t('admin.earnings.allOrders')}</h3>
      {loading && <p style={{ color: '#999' }}>{t('admin.earnings.loading')}</p>}
      {!loading && orders.length === 0 && <p style={{ color: '#999' }}>{t('admin.earnings.noOrders')}</p>}
      {!loading && orders.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#999', fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '1px solid #eee' }}>
              <th style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>{t('admin.earnings.col.restaurant')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.col.date')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.col.customer')}</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('admin.earnings.col.orderTotal')}</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', color: '#6366f1' }}>{t('admin.earnings.col.fee')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.col.settlement')}</th>
              <th style={{ padding: '0.5rem' }}>{t('admin.earnings.col.status')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={`${o.businessId}-${o.id}`} style={{ borderBottom: '1px solid #f9f9f9' }}>
                <td style={{ padding: '0.5rem 0.5rem 0.5rem 0', fontWeight: 600 }}>{o.businessName}</td>
                <td style={{ padding: '0.5rem', color: '#666', whiteSpace: 'nowrap' }}>
                  {toDate(o.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td style={{ padding: '0.5rem' }}>{o.customerName}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>€{o.total.toFixed(2)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right', color: '#6366f1', fontWeight: 600 }}>
                  €{calcFee(o.total, feeConfig).toFixed(2)}
                </td>
                <td style={{
                  padding: '0.5rem',
                  fontSize: '0.8rem',
                  color: o.settlementStatus === 'paid_out' ? '#16a34a' : o.settlementStatus === 'pending' ? '#d97706' : '#666',
                }}>
                  {t(`admin.earnings.settlementStatus.${settlementStatusKey(o.settlementStatus)}`)}
                  {o.settlementStatus === 'paid_out' && o.paidAt && (
                    <span style={{ display: 'block', color: '#999', fontSize: '0.72rem' }}>
                      {formatPayoutDate(o.paidAt)}
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.5rem', color: o.status === 'completed' ? '#16a34a' : '#d97706', fontSize: '0.8rem' }}>
                  {o.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
