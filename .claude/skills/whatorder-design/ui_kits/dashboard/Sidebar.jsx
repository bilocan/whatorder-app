// Dashboard sidebar — composes BrandLogo. Presence panel + nav.
const { BrandLogo } = window.WhatOrderDesignSystem_b54bed;

function Sidebar({ active, onNavigate, restaurant, onSignOut }) {
  const items = [
    ['orders', 'Orders'], ['customers', 'Customers'], ['income', 'Income'],
    ['menu', 'Menu'], ['phrases', 'Phrases'], ['settings', 'Settings'],
  ];
  return (
    <nav style={{
      width: 200, flexShrink: 0, padding: '1rem', borderRight: '1px solid var(--surface-border)',
      background: 'var(--surface)', display: 'flex', flexDirection: 'column', minHeight: '100%',
    }}>
      <div style={{ marginBottom: '1rem' }}><BrandLogo size="md" variant="light" /></div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.6rem',
        border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', marginBottom: '1rem',
        fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-strong)',
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{restaurant}</span>
        <span style={{ color: 'var(--text-quiet)', fontSize: '0.6rem' }}>▼</span>
      </div>

      <div style={{ flex: 1 }}>
        {items.map(([key, label]) => (
          <a key={key} onClick={() => onNavigate(key)}
            style={{
              display: 'block', padding: '0.5rem 0', cursor: 'pointer', textDecoration: 'none',
              color: active === key ? 'var(--text-strong)' : 'var(--text-tertiary)',
              fontWeight: active === key ? 600 : 400, fontSize: 'var(--text-md)',
            }}>
            {label}
          </a>
        ))}
      </div>

      <div style={{
        margin: '0.5rem 0 0.75rem', padding: '0.6rem 0.75rem', background: 'var(--surface-panel)',
        borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green-500)' }} />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Online — accepting orders</span>
        </div>
        <button style={{
          width: '100%', padding: '0.3rem 0', background: 'var(--danger-soft-bg)', border: 'none',
          borderRadius: 'var(--radius-sm)', color: 'var(--danger-soft-fg)', fontWeight: 600,
          cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'var(--font-sans)',
        }}>Pause orders</button>
      </div>

      <a onClick={onSignOut} style={{ padding: '0.5rem 0', color: 'var(--text-quiet)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>Sign out</a>
    </nav>
  );
}
window.Sidebar = Sidebar;
