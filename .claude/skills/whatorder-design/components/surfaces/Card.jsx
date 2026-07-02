import React from 'react';

/**
 * Surface container. `light` = white dashboard card (soft shadow, radius 12);
 * `dark` = marketing panel (raised bg, hairline border, border brightens on hover).
 */

export function Card({ surface = 'light', hover = false, style, children, ...rest }) {
  const [h, setH] = React.useState(false);
  const dark = surface === 'dark';

  return (
    <div
      onMouseEnter={hover ? () => setH(true) : undefined}
      onMouseLeave={hover ? () => setH(false) : undefined}
      style={{
        background: dark ? 'var(--bg-raised)' : 'var(--surface)',
        border: dark
          ? `1px solid ${h ? 'var(--border-hover)' : 'var(--border)'}`
          : '1px solid var(--surface-border)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: dark ? 'none' : 'var(--shadow-card)',
        padding: 'var(--space-6)',
        transition: 'border-color 0.2s',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
