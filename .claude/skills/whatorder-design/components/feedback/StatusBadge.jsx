import React from 'react';

/**
 * Order-status pill. Renders the status label in its lifecycle hue on a
 * translucent fill of the same hue — the dashboard's core status signature.
 */

const STATUS = {
  pending:    { c: 'var(--status-pending)',    label: 'Pending' },
  approved:   { c: 'var(--status-approved)',   label: 'Approved' },
  preparing:  { c: 'var(--status-preparing)',  label: 'Preparing' },
  ready:      { c: 'var(--status-ready)',      label: 'Ready for pickup' },
  on_the_way: { c: 'var(--status-on-the-way)', label: 'Out for delivery' },
  picked_up:  { c: 'var(--status-picked-up)',  label: 'Picked up' },
  delivered:  { c: 'var(--status-delivered)',  label: 'Delivered' },
  completed:  { c: 'var(--status-completed)',  label: 'Completed' },
  rejected:   { c: 'var(--status-rejected)',   label: 'Rejected' },
  cancelled:  { c: 'var(--status-cancelled)',  label: 'Cancelled' },
};

export function StatusBadge({ status = 'pending', label, style }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--fw-semibold)',
        color: s.c,
        background: `color-mix(in srgb, ${s.c} 13%, transparent)`,
        padding: '0.2rem 0.6rem',
        borderRadius: 'var(--radius-pill)',
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {label ?? s.label}
    </span>
  );
}
