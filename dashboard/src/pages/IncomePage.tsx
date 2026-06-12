import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useFeeConfig, calcFee } from '../hooks/useFeeConfig';
import type { Order } from '../types';
import { toDate } from '../types';

export default function IncomePage() {
  const { businessId } = useAuth();
  const feeConfig = useFeeConfig();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!businessId) return;
    getDocs(collection(db, 'businesses', businessId, 'orders')).then((snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as Order)));
    });
  }, [businessId]);

  const today = new Date().toDateString();
  const todayOrders = orders.filter((o) => toDate(o.createdAt).toDateString() === today);
  const earned = todayOrders.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total, 0);
  const pending = todayOrders.filter((o) => o.status !== 'completed').reduce((s, o) => s + o.total, 0);
  const totalFee = todayOrders.reduce((s, o) => s + calcFee(o.total, feeConfig), 0);

  return (
    <div>
      <h2>Income — Today</h2>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Earned', value: `€${earned.toFixed(2)}` },
          { label: 'Pending', value: `€${pending.toFixed(2)}` },
          { label: 'Orders', value: String(todayOrders.length) },
          { label: 'WhatOrder Fee', value: `€${totalFee.toFixed(2)}`, accent: true },
        ].map(({ label, value, accent }) => (
          <div key={label} style={{ padding: '1rem 1.5rem', border: `1px solid ${accent ? '#6366f1' : '#eee'}`, borderRadius: 10, minWidth: 120 }}>
            <div style={{ fontSize: '0.75rem', color: accent ? '#6366f1' : '#999', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: accent ? '#6366f1' : 'inherit' }}>{value}</div>
          </div>
        ))}
      </div>

      <h3 style={{ borderBottom: '1px solid #eee', paddingBottom: '0.4rem' }}>Breakdown</h3>
      {todayOrders.length === 0 && <p style={{ color: '#999' }}>No orders today.</p>}
      {todayOrders.map((order) => (
        <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f9f9f9' }}>
          <div>
            <span style={{ fontWeight: 600 }}>{order.customerName}</span>
            <span style={{ color: '#999', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              {toDate(order.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span>€{order.total.toFixed(2)}</span>
            <span style={{ fontSize: '0.8rem', color: '#6366f1' }}>Fee: €{calcFee(order.total, feeConfig).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
