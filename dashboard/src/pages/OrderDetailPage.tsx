import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useParams, Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order } from '../types';
import { toDate } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { businessId } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!orderId || !businessId) return;
    getDoc(doc(db, 'businesses', businessId, 'orders', orderId)).then((snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data() } as Order);
    });
  }, [orderId, businessId]);

  async function markReady() {
    if (!orderId || !order || !businessId) return;
    const res = await fetch(`${API_URL}/businesses/${businessId}/orders/${orderId}/ready`, { method: 'POST' });
    if (!res.ok) {
      console.error('Mark ready failed:', await res.text());
      return;
    }
    setOrder((o) => o ? { ...o, status: 'ready' } : o);
  }

  if (!order) return <p style={{ padding: '1rem' }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 480 }}>
      <Link to="/orders" style={{ fontSize: '0.9rem', color: '#666', textDecoration: 'none' }}>← Back to orders</Link>
      <h2 style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }}>{order.customerName}</h2>
      <p style={{ color: '#999', margin: 0, marginBottom: '1.5rem' }}>{order.customerPhone}</p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '0.4rem 0' }}>Item</th>
            <th style={{ padding: '0.4rem' }}>Qty</th>
            <th style={{ padding: '0.4rem', textAlign: 'right' }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.5rem 0' }}>{item.name}</td>
              <td style={{ padding: '0.5rem' }}>{item.qty}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>€{(item.price * item.qty).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ fontWeight: 700, fontSize: '1.1rem', textAlign: 'right' }}>Total: €{order.total.toFixed(2)}</p>

      {order.notes && (
        <p style={{ color: '#666', background: '#fafafa', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.9rem' }}>
          Note: {order.notes}
        </p>
      )}

      <p style={{ color: '#999', fontSize: '0.85rem' }}>
        Ordered at {toDate(order.createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
      </p>

      {order.status === 'pending' && (
        <button
          onClick={markReady}
          style={{ marginTop: '0.5rem', padding: '0.7rem 2rem', background: '#000', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '1rem' }}
        >
          Mark as Ready
        </button>
      )}
      {order.status === 'ready' && (
        <p style={{ color: '#3b82f6', fontWeight: 600 }}>Ready for pickup</p>
      )}
      {order.status === 'completed' && (
        <p style={{ color: '#22c55e', fontWeight: 600 }}>Completed</p>
      )}
    </div>
  );
}
