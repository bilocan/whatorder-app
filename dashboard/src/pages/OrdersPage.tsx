import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order } from '../types';
import { toDate } from '../types';

const statusColor: Record<string, string> = {
  pending: '#f59e0b',
  ready: '#3b82f6',
  completed: '#22c55e',
};

export default function OrdersPage() {
  const { businessId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, 'businesses', businessId, 'orders'),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Order)));
    });
  }, [businessId]);

  return (
    <div>
      <h2>Orders</h2>
      {orders.length === 0 && <p style={{ color: '#999' }}>No orders yet.</p>}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
            <th style={{ padding: '0.5rem' }}>Customer</th>
            <th style={{ padding: '0.5rem' }}>Items</th>
            <th style={{ padding: '0.5rem' }}>Total</th>
            <th style={{ padding: '0.5rem' }}>Status</th>
            <th style={{ padding: '0.5rem' }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <Link to={`/orders/${order.id}`} style={{ fontWeight: 600, color: '#000', textDecoration: 'none' }}>
                  {order.customerName}
                </Link>
                <div style={{ fontSize: '0.8rem', color: '#999' }}>{order.customerPhone}</div>
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.9rem' }}>
                {order.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600 }}>€{order.total.toFixed(2)}</td>
              <td style={{ padding: '0.75rem 0.5rem' }}>
                <span style={{
                  background: statusColor[order.status] + '22',
                  color: statusColor[order.status],
                  padding: '0.2rem 0.6rem',
                  borderRadius: 999,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                }}>
                  {order.status}
                </span>
              </td>
              <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.85rem', color: '#666' }}>
                {toDate(order.createdAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
