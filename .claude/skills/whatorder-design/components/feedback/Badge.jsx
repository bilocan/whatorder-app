import React from 'react';

/**
 * Marketing status pill — green text on an accent wash with a pulsing dot.
 * Used for the "Pilot · Vienna" eyebrow on the dark site. Uppercase, tracked.
 */

export function Badge({ children, pulse = true, style }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--accent)',
        background: 'var(--accent-wash)',
        border: '1px solid rgba(34, 197, 94, 0.25)',
        padding: '0.35rem 0.9rem',
        borderRadius: 'var(--radius-pill)',
        letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      {pulse && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'wo-pulse 2s infinite',
          }}
        />
      )}
      <style>{'@keyframes wo-pulse{0%,100%{opacity:1}50%{opacity:.3}}'}</style>
      {children}
    </span>
  );
}
