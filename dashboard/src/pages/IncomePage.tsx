import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Order } from '../types';

const BUSINESS_ID = 'biz_test';

export default function IncomePage() {
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    getDocs(collection(db, 'businesses', BUSINESS_ID, 'orders')).then((snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    });
  }, []);

  const today = new Date().toDateString();
  const todayOrders = orders.filter((o) => new Date(o.createdAt).toDateString() === today);
  const earned = todayOrders.filter((o) => o.status === 'completed').reduce((s, o) => s + o.total, 0);
  const pending = todayOrders.filter((o) => o.status !== 'completed').reduce((s, o) => s + o.total, 0);

  return (
    <div>
      <h2>Income — Today</h2>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Earned', value: `€${earned.toFixed(2)}` },
          { label: 'Pending', value: `€${pending.toFixed(2)}` },
          { label: 'Orders', value: String(todayOrders.length) },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: '1rem 1.5rem', border: '1px solid #eee', borderRadius: 10, minWidth: 120 }}>
            <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{value}</div>
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
              {new Date(order.createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <span>€{order.total.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
