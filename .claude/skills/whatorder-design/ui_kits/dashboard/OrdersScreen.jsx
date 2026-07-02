// Orders list — composes StatusBadge, PaymentBadge, Select.
const WOOrders = window.WhatOrderDesignSystem_b54bed;

function OrdersScreen({ orders, onOpen }) {
  const [filter, setFilter] = React.useState('active');
  const TERMINAL = ['delivered', 'picked_up', 'rejected', 'cancelled', 'completed'];
  const visible = orders.filter((o) => filter === 'active' ? !TERMINAL.includes(o.status) : TERMINAL.includes(o.status));
  const th = { padding: '0.5rem', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontWeight: 600 };
  const td = { padding: '0.75rem 0.5rem', fontSize: 'var(--text-base)' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', color: 'var(--text-strong)' }}>Orders</h2>
        <WOOrders.Select ariaLabel="Show" value={filter} onChange={(e) => setFilter(e.target.value)}
          options={[{ value: 'active', label: 'Active orders' }, { value: 'done', label: 'Completed — last 2 weeks' }]} />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--surface-border)' }}>
              <th style={th}>Order #</th><th style={th}>Customer</th><th style={th}>Items</th>
              <th style={th}>Total</th><th style={th}>Payment</th><th style={th}>Status</th><th style={th}>Time</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o.id} style={{ borderBottom: '1px solid var(--paper-200)', cursor: 'pointer' }} onClick={() => onOpen(o.id)}>
                <td style={{ ...td, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>#{o.shortId}</td>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-strong)' }}>{o.customerName}</span>
                    {o.type === 'delivery' && (
                      <span style={{ background: 'color-mix(in srgb, var(--delivery) 13%, transparent)', color: 'var(--delivery)', padding: '0.1rem 0.5rem', borderRadius: 'var(--radius-pill)', fontSize: '0.72rem', fontWeight: 700 }}>Delivery</span>
                    )}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-quiet)' }}>{o.customerPhone}</div>
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>{o.items.map((i) => `${i.qty}x ${i.name}`).join(', ')}</td>
                <td style={{ ...td, fontWeight: 600, color: 'var(--text-strong)' }}>€{o.total.toFixed(2)}</td>
                <td style={td}><WOOrders.PaymentBadge kind={o.payment} /></td>
                <td style={td}><WOOrders.StatusBadge status={o.status} /></td>
                <td style={{ ...td, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>{o.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
window.OrdersScreen = OrdersScreen;
