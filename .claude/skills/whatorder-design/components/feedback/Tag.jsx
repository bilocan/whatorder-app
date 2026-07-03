import React from 'react';

/**
 * Neutral category chip used in the marketing "who it's for" list
 * (Döner & Kebab, Pizzerias, …). Muted text on the page bg with a hairline border.
 */

export function Tag({ children, style }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text-muted)',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        padding: '0.35rem 0.9rem',
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
