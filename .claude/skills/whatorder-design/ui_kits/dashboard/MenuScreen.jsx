// Menu screen — item list grouped by category, availability toggle, Button.
const WOMenu = window.WhatOrderDesignSystem_b54bed;

function MenuScreen({ menu, onToggle }) {
  const cats = ['Mains', 'Sides', 'Drinks'];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', color: 'var(--text-strong)' }}>Menu</h2>
        <WOMenu.Button variant="primary" size="sm">+ Add item</WOMenu.Button>
      </div>

      {cats.map((cat) => (
        <div key={cat} style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-quiet)', fontWeight: 600, margin: '0 0 0.5rem' }}>{cat}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {menu.filter((m) => m.category === cat).map((m) => (
              <div key={m.name} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem',
                background: 'var(--surface)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)',
              }}>
                <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-strong)', opacity: m.available ? 1 : 0.45 }}>{m.name}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-body)', fontVariantNumeric: 'tabular-nums' }}>€{m.price.toFixed(2)}</span>
                <button onClick={() => onToggle(m.name)} style={{
                  fontFamily: 'var(--font-sans)', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
                  padding: '0.2rem 0.7rem', borderRadius: 'var(--radius-pill)', border: 'none',
                  background: m.available ? 'var(--success-soft-bg)' : 'var(--paper-200)',
                  color: m.available ? 'var(--success-soft-fg)' : 'var(--text-quiet)',
                }}>{m.available ? 'Available' : 'Off'}</button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
window.MenuScreen = MenuScreen;
