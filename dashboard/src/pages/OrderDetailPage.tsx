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
  const [markReadyError, setMarkReadyError] = useState('');
  const [markingReady, setMarkingReady] = useState(false);

  useEffect(() => {
    if (!orderId || !businessId) return;
    getDoc(doc(db, 'businesses', businessId, 'orders', orderId)).then((snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } as Order);
    });
  }, [orderId, businessId]);

  async function markReady() {
    if (!orderId || !order || !businessId) return;
    setMarkingReady(true);
    setMarkReadyError('');
    try {
      const res = await fetch(`${API_URL}/businesses/${businessId}/orders/${orderId}/ready`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMarkReadyError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setOrder((o) => o ? { ...o, status: 'ready' } : o);
    } catch {
      setMarkReadyError('Network error — is the backend running?');
    } finally {
      setMarkingReady(false);
    }
  }

  if (!order) return <p style={{ padding: '1rem' }}>Loading...</p>;

  return (
    <div style={{ maxWidth: 480 }}>
      <Link to="/orders" style={{ fontSize: '0.9rem', color: '#666', textDecoration: 'none' }}>← Back to orders</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', marginBottom: '0.1rem' }}>
        <h2 style={{ margin: 0 }}>{order.customerName}</h2>
        {order.orderType === 'delivery' && (
          <span style={{ background: '#0ea5e922', color: '#0ea5e9', padding: '0.15rem 0.6rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.02em' }}>
            DELIVERY
          </span>
        )}
      </div>
      <p style={{ color: '#999', margin: 0, marginBottom: order.orderType === 'delivery' ? '0.25rem' : '1.5rem' }}>{order.customerPhone}</p>
      {order.orderType === 'delivery' && order.deliveryAddress && (
        <p style={{ color: '#0ea5e9', fontSize: '0.85rem', margin: '0 0 1.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.25rem' }}>
          🚚 {order.deliveryAddress}
        </p>
      )}

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

      {order.orderType === 'delivery' && order.deliveryFee ? (
        <p style={{ fontSize: '0.85rem', color: '#999', textAlign: 'right', margin: '0.25rem 0 0' }}>
          Delivery fee: €{order.deliveryFee.toFixed(2)}
        </p>
      ) : null}
      <p style={{ fontWeight: 700, fontSize: '1.1rem', textAlign: 'right' }}>Total: €{order.total.toFixed(2)}</p>

      {order.notes && (
        <p style={{ color: '#666', background: '#fafafa', padding: '0.5rem 0.75rem', borderRadius: 6, fontSize: '0.9rem' }}>
          Note: {order.notes}
        </p>
      )}

      <p style={{ color: '#999', fontSize: '0.85rem' }}>
        Ordered at {toDate(order.createdAt).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </p>

      {order.status === 'pending' && (
        <>
          <button
            onClick={markReady}
            disabled={markingReady}
            style={{ marginTop: '0.5rem', padding: '0.7rem 2rem', background: '#000', color: '#fff', border: 'none', borderRadius: 8, cursor: markingReady ? 'default' : 'pointer', fontWeight: 600, fontSize: '1rem', opacity: markingReady ? 0.6 : 1 }}
          >
            {markingReady ? 'Saving…' : 'Mark as Ready'}
          </button>
          {markReadyError && (
            <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{markReadyError}</p>
          )}
        </>
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
