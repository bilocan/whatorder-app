import { useEffect, useState } from 'react';
import { collection, collectionGroup, getDocs, doc, setDoc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../../lib/firebase';
import { useFeeConfig, calcFee } from '../../hooks/useFeeConfig';
import type { FeeConfig } from '../../hooks/useFeeConfig';
import type { Order, Business } from '../../types';
import { toDate } from '../../types';
import { filterOrdersByPhoneRouting } from '../../lib/orderPhoneFilter';
import { useAdminPhoneLine } from '../../contexts/AdminPhoneLineContext';

type OrderRow = Order & { businessId: string; businessName: string };

export default function EarningsPage() {
  const { t } = useTranslation();
  const feeConfig = useFeeConfig();
  const { phoneNumberId } = useAdminPhoneLine();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editType, setEditType] = useState<FeeConfig['feeType']>(feeConfig.feeType);
  const [editValue, setEditValue] = useState(String(feeConfig.feeValue));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditType(feeConfig.feeType);
    setEditValue(String(feeConfig.feeValue));
  }, [feeConfig]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [businessSnap, ordersSnap] = await Promise.all([
        getDocs(collection(db, 'businesses')),
        getDocs(collectionGroup(db, 'orders')),
      ]);
      if (cancelled) return;

      const nameMap = new Map<string, string>();
      businessSnap.docs.forEach((d) => {
        const b = d.data() as Business;
        nameMap.set(d.id, b.name ?? d.id);
      });

      const rows: OrderRow[] = ordersSnap.docs.map((d) => {
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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [phoneNumberId]);

  async function saveFeeConfig() {
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    await setDoc(doc(db, 'config', 'whatorder'), { feeType: editType, feeValue: val });
    setSaving(false);
  }

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
  const totalFees = orders.reduce((s, o) => s + calcFee(o.total, feeConfig), 0);

  const pendingSettlementCents = orders
    .filter((o) => o.settlementStatus === 'pending' || o.settlementStatus === 'included_in_payout')
    .reduce((s, o) => s + (o.restaurantNetCents ?? 0), 0);
  const paidOutCents = orders
    .filter((o) => o.settlementStatus === 'paid_out')
    .reduce((s, o) => s + (o.restaurantNetCents ?? 0), 0);
  const refundedCount = orders.filter((o) => o.settlementStatus === 'refunded').length;

  const pendingByRestaurant = new Map<string, number>();
  orders
    .filter((o) => o.settlementStatus === 'pending' || o.settlementStatus === 'included_in_payout')
    .forEach((o) => {
      pendingByRestaurant.set(o.businessName, (pendingByRestaurant.get(o.businessName) ?? 0) + (o.restaurantNetCents ?? 0));
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
