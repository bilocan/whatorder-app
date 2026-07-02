// Order detail — lifecycle actions via Button `tone`, StatusBadge, PaymentBadge.
const WODetail = window.WhatOrderDesignSystem_b54bed;

const STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved', preparing: 'Preparing', ready: 'Ready for pickup',
  on_the_way: 'Out for delivery', picked_up: 'Picked up', delivered: 'Delivered',
  rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed',
};

function actionsFor(status, type) {
  switch (status) {
    case 'pending': return [
      { label: 'Approve', next: 'approved', variant: 'primary' },
      { label: 'Reject', next: 'rejected', variant: 'danger' },
    ];
    case 'approved': return [{ label: 'Start Preparation', next: 'preparing', tone: 'var(--status-preparing)' }];
    case 'preparing': return type === 'delivery'
      ? [{ label: 'Out for Delivery', next: 'on_the_way', tone: 'var(--status-on-the-way)' }]
      : [{ label: 'Mark Ready', next: 'ready', tone: 'var(--status-ready)' }];
    case 'ready': return [{ label: 'Mark Picked Up', next: 'picked_up', tone: 'var(--status-delivered)' }];
    case 'on_the_way': return [{ label: 'Mark Delivered', next: 'delivered', tone: 'var(--status-delivered)' }];
    default: return [];
  }
}

function OrderDetailScreen({ order, onBack, onAdvance }) {
  const buttons = actionsFor(order.status, order.type);
  const th = { padding: '0.4rem 0', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontWeight: 600, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 480 }}>
      <a onClick={onBack} style={{ fontSize: 'var(--text-base)', color: 'var(--text-tertiary)', cursor: 'pointer' }}>← Back to orders</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', color: 'var(--text-strong)' }}>{order.customerName}</h2>
        {order.type === 'delivery' && (
          <span style={{ background: 'color-mix(in srgb, var(--delivery) 13%, transparent)', color: 'var(--delivery)', padding: '0.15rem 0.6rem', borderRadius: 'var(--radius-pill)', fontSize: '0.75rem', fontWeight: 700 }}>Delivery</span>
        )}
      </div>
      <p style={{ color: 'var(--text-quiet)', margin: '0.25rem 0 0', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>#{order.shortId}</p>
      <p style={{ color: 'var(--text-quiet)', margin: '0.1rem 0 0' }}>{order.customerPhone}</p>
      {order.type === 'delivery' && order.deliveryAddress && (
        <p style={{ color: 'var(--delivery)', fontSize: 'var(--text-base)', margin: '0.5rem 0 0' }}>🚚 {order.deliveryAddress}</p>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '1.25rem 0 1rem' }}>
        <thead><tr style={{ borderBottom: '2px solid var(--surface-border)' }}>
          <th style={th}>Item</th><th style={{ ...th, textAlign: 'center' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Price</th>
        </tr></thead>
        <tbody>
          {order.items.map((it, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--paper-200)' }}>
              <td style={{ padding: '0.5rem 0', color: 'var(--text-body)' }}>{it.name}</td>
              <td style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{it.qty}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-body)' }}>€{(it.price * it.qty).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.type === 'delivery' && order.deliveryFee ? (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-quiet)', textAlign: 'right', margin: 0 }}>Delivery fee: €{order.deliveryFee.toFixed(2)}</p>
      ) : null}
      <p style={{ fontWeight: 700, fontSize: 'var(--text-lg)', textAlign: 'right', color: 'var(--text-strong)' }}>Total: €{order.total.toFixed(2)}</p>

      {order.notes && (
        <p style={{ color: 'var(--text-secondary)', background: 'var(--surface-app)', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-base)' }}>Note: {order.notes}</p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '1rem 0' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>Status</span>
        <WODetail.StatusBadge status={order.status} />
        <WODetail.PaymentBadge kind={order.payment} />
      </div>

      {buttons.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {buttons.map((b) => (
            <WODetail.Button key={b.label} variant={b.variant || 'primary'} tone={b.tone} onClick={() => onAdvance(order.id, b.next)}>
              {b.label}
            </WODetail.Button>
          ))}
        </div>
      )}
      {buttons.length === 0 && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-quiet)' }}>This order is {STATUS_LABEL[order.status].toLowerCase()} — no further action.</p>
      )}
    </div>
  );
}
window.OrderDetailScreen = OrderDetailScreen;
