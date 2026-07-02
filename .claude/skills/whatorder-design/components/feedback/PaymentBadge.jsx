import React from 'react';

/**
 * Payment-state pill. Same translucent-fill treatment as StatusBadge, in the
 * payment hue set: cash (amber), paid (green), unpaid (amber), failed (red).
 */

const KINDS = {
  cash:   { c: 'var(--pay-cash)',   label: 'Cash' },
  paid:   { c: 'var(--pay-paid)',   label: 'Paid' },
  unpaid: { c: 'var(--pay-unpaid)', label: 'Unpaid' },
  failed: { c: 'var(--pay-failed)', label: 'Failed' },
};

export function PaymentBadge({ kind = 'cash', label, style }) {
  const k = KINDS[kind] ?? KINDS.cash;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--fw-semibold)',
        color: k.c,
        background: `color-mix(in srgb, ${k.c} 13%, transparent)`,
        padding: '0.2rem 0.6rem',
        borderRadius: 'var(--radius-pill)',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {label ?? k.label}
    </span>
  );
}
