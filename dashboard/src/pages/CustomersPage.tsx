import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Customer } from '../types';
import { toDate } from '../types';

export default function CustomersPage() {
  const { t } = useTranslation();
  const { businessId } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');

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
        style={{ width: '100%', maxWidth: 320, padding: '0.4rem 0.6rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: '0.9rem', marginBottom: '1rem', boxSizing: 'border-box' }}
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
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.phone} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '0.75rem 0.5rem' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#999' }}>{c.phone}</div>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
