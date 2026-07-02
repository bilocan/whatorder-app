import React from 'react';

/**
 * Section eyebrow — the small green uppercase label above marketing headings
 * ("How it works", "Who it's for").
 */

export function SectionLabel({ children, style }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--fw-semibold)',
        letterSpacing: 'var(--tracking-label)',
        textTransform: 'uppercase',
        color: 'var(--accent)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
