import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useParams, Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Order, OrderStatus } from '../types';
import { toDate } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

type ActionButton = { label: string; action: string; style?: React.CSSProperties };

function getActionButtons(status: OrderStatus, orderType?: string): ActionButton[] {
  switch (status) {
    case 'pending':
      return [
        { label: 'Approve', action: 'approve', style: { background: '#000' } },
        { label: 'Reject',  action: 'reject',  style: { background: '#ef4444' } },
      ];
    case 'approved':
      return [{ label: 'Start Preparation', action: 'prepare', style: { background: '#f97316' } }];
    case 'preparing':
      return orderType === 'delivery'
        ? [{ label: 'Out for Delivery', action: 'on-the-way', style: { background: '#06b6d4' } }]
        : [{ label: 'Mark Ready',       action: 'ready',      style: { background: '#3b82f6' } }];
    case 'ready':
      return [{ label: 'Mark Picked Up', action: 'picked-up', style: { background: '#22c55e' } }];
    case 'on_the_way':
      return [{ label: 'Mark Delivered', action: 'delivered', style: { background: '#22c55e' } }];
    default:
      return [];
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending:    'Pending',
  approved:   'Approved',
  preparing:  'Preparing',
  ready:      'Ready for pickup',
  on_the_way: 'Out for delivery',
  picked_up:  'Picked up',
  delivered:  'Delivered',
  rejected:   'Rejected',
  cancelled:  'Cancelled',
  completed:  'Completed',
};

const STATUS_COLOR: Record<string, string> = {
  pending:    '#f59e0b',
  approved:   '#a855f7',
  preparing:  '#f97316',
  ready:      '#3b82f6',
  on_the_way: '#06b6d4',
  picked_up:  '#22c55e',
  delivered:  '#22c55e',
  rejected:   '#ef4444',
  cancelled:  '#6b7280',
  completed:  '#22c55e',
};

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { businessId } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orderId || !businessId) return;
    getDoc(doc(db, 'businesses', businessId, 'orders', orderId)).then((snap) => {
      if (snap.exists()) setOrder({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } as Order);
    });
  }, [orderId, businessId]);

  async function doAction(action: string) {
    if (!orderId || !order || !businessId) return;
    setLoading(true);
    setActionError('');
    try {
      const res = await fetch(`${API_URL}/businesses/${businessId}/orders/${orderId}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      const nextStatus: Record<string, OrderStatus> = {
        approve:    'approved',
        reject:     'rejected',
        prepare:    'preparing',
        ready:      'ready',
        'on-the-way': 'on_the_way',
        'picked-up':  'picked_up',
        delivered:  'delivered',
        cancel:     'cancelled',
      };
      if (nextStatus[action]) setOrder((o) => o ? { ...o, status: nextStatus[action] } : o);
    } catch {
      setActionError('Network error — is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  if (!order) return <p style={{ padding: '1rem' }}>Loading...</p>;

  const buttons = getActionButtons(order.status, order.orderType);
  const color = STATUS_COLOR[order.status] ?? '#999';

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

      <p style={{ fontWeight: 600, color }}>
        {STATUS_LABEL[order.status] ?? order.status}
      </p>

      {buttons.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          {buttons.map(({ label, action, style }) => (
            <button
              key={action}
              onClick={() => doAction(action)}
              disabled={loading}
              style={{
                padding: '0.7rem 1.5rem',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: loading ? 'default' : 'pointer',
                fontWeight: 600,
                fontSize: '0.95rem',
                opacity: loading ? 0.6 : 1,
                ...style,
              }}
            >
              {loading ? 'Saving…' : label}
            </button>
          ))}
        </div>
      )}
      {actionError && (
        <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.5rem' }}>{actionError}</p>
      )}
    </div>
  );
}
