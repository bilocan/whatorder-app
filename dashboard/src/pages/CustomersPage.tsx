import { useEffect, useState } from 'react';
import {
  collection, onSnapshot, orderBy, query,
  deleteDoc, updateDoc, doc, getDocs, where,
} from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Customer, Order } from '../types';
import { toDate } from '../types';

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);

const HistoryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);

const btnSecondary: React.CSSProperties = {
  padding: '0.25rem 0.6rem',
  background: 'none',
  border: '1px solid #ddd',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: '0.78rem',
};


const btnGhost: React.CSSProperties = {
  padding: '0.3rem',
  background: 'none',
  border: '1px solid #bfdbfe',
  color: '#2563eb',
  borderRadius: 5,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 0,
};

const btnIconEdit: React.CSSProperties = {
  padding: '0.3rem',
  background: 'none',
  border: '1px solid #e5e7eb',
  borderRadius: 5,
  cursor: 'pointer',
  color: '#6b7280',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 0,
};

const btnIconDelete: React.CSSProperties = {
  padding: '0.3rem',
  background: 'none',
  border: '1px solid #fca5a5',
  borderRadius: 5,
  cursor: 'pointer',
  color: '#ef4444',
  display: 'inline-flex',
  alignItems: 'center',
  lineHeight: 0,
};

export default function CustomersPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');

  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [editNameVal, setEditNameVal] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'businesses', businessId, 'customers'),
      orderBy('lastOrderDate', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setCustomers(snap.docs.map((d) => d.data() as Customer));
    });
  }, [businessId]);

  const filtered = search.trim()
    ? customers.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.phone.includes(search),
      )
    : customers;

  function startEdit(c: Customer) {
    setEditingPhone(c.phone);
    setEditNameVal(c.name);
  }

  async function saveName(phone: string) {
    if (!businessId) return;
    setSavingName(true);
    await updateDoc(doc(db, 'businesses', businessId, 'customers', phone), {
      name: editNameVal.trim() || 'WhatsApp Customer',
    });
    setSavingName(false);
    setEditingPhone(null);
  }

  async function handleDelete(phone: string) {
    if (!businessId || !confirm(t('customers.deleteConfirm'))) return;
    if (expandedPhone === phone) setExpandedPhone(null);
    if (editingPhone === phone) setEditingPhone(null);
    await deleteDoc(doc(db, 'businesses', businessId, 'customers', phone));
  }

  async function toggleHistory(phone: string) {
    if (expandedPhone === phone) {
      setExpandedPhone(null);
      return;
    }
    setExpandedPhone(phone);
    setHistoryOrders([]);
    setHistoryLoading(true);
    const snap = await getDocs(
      query(
        collection(db, 'businesses', businessId!, 'orders'),
        where('customerPhone', '==', phone),
        orderBy('createdAt', 'desc'),
      ),
    );
    setHistoryOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    setHistoryLoading(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>{t('customers.title')}</h2>
        <span style={{ fontSize: '0.85rem', color: '#999' }}>{t('customers.totalCount', { count: customers.length })}</span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('customers.search')}
        style={{
          width: '100%', maxWidth: 320, padding: '0.4rem 0.6rem',
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6,
          fontSize: '0.9rem', marginBottom: '1rem', boxSizing: 'border-box',
        }}
      />

      {filtered.length === 0 && (
        <p style={{ color: '#999' }}>{search ? t('customers.noMatch') : t('customers.noCustomers')}</p>
      )}

      {filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
              <th style={{ padding: '0.5rem' }}>{t('customers.col.customer')}</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('customers.col.orders')}</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>{t('customers.col.totalSpent')}</th>
              <th style={{ padding: '0.5rem' }}>{t('customers.col.lastOrder')}</th>
              <th style={{ padding: '0.5rem' }}>{t('customers.col.lastAddress')}</th>
              <th style={{ padding: '0.5rem' }}>{t('customers.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <>
                <tr key={c.phone} style={{ borderBottom: expandedPhone === c.phone ? 'none' : '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    {editingPhone === c.phone ? (
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <input
                          value={editNameVal}
                          onChange={(e) => setEditNameVal(e.target.value)}
                          style={{ padding: '0.25rem 0.5rem', border: '1px solid #ddd', borderRadius: 5, fontSize: '0.9rem' }}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveName(c.phone); if (e.key === 'Escape') setEditingPhone(null); }}
                          autoFocus
                        />
                        <button
                          onClick={() => saveName(c.phone)}
                          disabled={savingName}
                          style={{ ...btnSecondary, color: '#000', fontWeight: 600 }}
                        >
                          {savingName ? t('customers.saving') : t('customers.save')}
                        </button>
                        <button onClick={() => setEditingPhone(null)} style={btnSecondary}>{t('customers.cancel')}</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#999' }}>{c.phone}</div>
                      </>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                    {c.orderCount ?? 0}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right', fontWeight: 600 }}>
                    €{(c.totalSpent ?? 0).toFixed(2)}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.85rem', color: '#666' }}>
                    {c.lastOrderDate
                      ? toDate(c.lastOrderDate).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' })
                      : '—'}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.8rem', color: c.lastDeliveryAddress ? '#0ea5e9' : '#ccc', maxWidth: 220 }}>
                    {c.lastDeliveryAddress ? (
                      <span title={c.lastDeliveryAddress}>
                        🚚 {c.lastDeliveryAddress.length > 40 ? c.lastDeliveryAddress.slice(0, 40) + '…' : c.lastDeliveryAddress}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ padding: '0.75rem 0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {editingPhone !== c.phone && (
                        <button style={btnIconEdit} title={t('customers.edit')} onClick={() => startEdit(c)}><PencilIcon /></button>
                      )}
                      <button
                        style={{ ...btnGhost, background: expandedPhone === c.phone ? '#dbeafe' : 'none' }}
                        title={t('customers.history')}
                        onClick={() => toggleHistory(c.phone)}
                      >
                        <HistoryIcon />
                      </button>
                      <button style={btnIconDelete} title={t('customers.delete')} onClick={() => handleDelete(c.phone)}><TrashIcon /></button>
                    </div>
                  </td>
                </tr>

                {expandedPhone === c.phone && (
                  <tr key={`${c.phone}-history`} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td colSpan={6} style={{ padding: '0 0.5rem 0.75rem', background: '#f9fafb' }}>
                      <div style={{ padding: '0.75rem', borderRadius: 6 }}>
                        <strong style={{ fontSize: '0.85rem', color: '#333' }}>{t('customers.orderHistory')}</strong>
                        {historyLoading && (
                          <p style={{ color: '#999', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{t('customers.loading')}</p>
                        )}
                        {!historyLoading && historyOrders.length === 0 && (
                          <p style={{ color: '#999', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{t('customers.noOrders')}</p>
                        )}
                        {!historyLoading && historyOrders.length > 0 && (
                          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                            <thead>
                              <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                                <th style={{ padding: '0.3rem 0.4rem', fontSize: '0.78rem', color: '#666', fontWeight: 500 }}>{t('customers.historyCol.date')}</th>
                                <th style={{ padding: '0.3rem 0.4rem', fontSize: '0.78rem', color: '#666', fontWeight: 500 }}>{t('customers.historyCol.items')}</th>
                                <th style={{ padding: '0.3rem 0.4rem', fontSize: '0.78rem', color: '#666', fontWeight: 500, textAlign: 'right' }}>{t('customers.historyCol.total')}</th>
                                <th style={{ padding: '0.3rem 0.4rem', fontSize: '0.78rem', color: '#666', fontWeight: 500 }}>{t('customers.historyCol.status')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {historyOrders.map((o) => (
                                <tr key={o.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                  <td style={{ padding: '0.4rem', fontSize: '0.82rem', color: '#555' }}>
                                    {o.createdAt ? toDate(o.createdAt).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                                  </td>
                                  <td style={{ padding: '0.4rem', fontSize: '0.82rem', color: '#333' }}>
                                    {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                                  </td>
                                  <td style={{ padding: '0.4rem', fontSize: '0.82rem', fontWeight: 600, textAlign: 'right' }}>
                                    €{o.total.toFixed(2)}
                                  </td>
                                  <td style={{ padding: '0.4rem', fontSize: '0.78rem', color: '#777' }}>
                                    {o.status}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
