import React from 'react';

/**
 * WhatOrder button. Two primary flavors match the two surfaces:
 * `primary` (solid black — dashboard) and `accent` (solid green — marketing).
 * `ghost` and `danger` round out the set. `tone` overrides the fill with any
 * order-status hue for lifecycle action buttons (Approve / Prepare / …).
 */

const SIZES = {
  sm: { padding: '0.45rem 1rem', fontSize: 'var(--text-sm)' },
  md: { padding: '0.7rem 1.5rem', fontSize: '0.95rem' },
  lg: { padding: '0.8rem 1.8rem', fontSize: '0.95rem' },
};

function baseFill(variant) {
  switch (variant) {
    case 'accent': return { bg: 'var(--green-500)', bgHover: 'var(--green-600)', fg: '#000', border: 'transparent', lift: true };
    case 'ghost':  return { bg: 'transparent', bgHover: 'transparent', fg: 'var(--text)', border: 'var(--border)', borderHover: 'var(--border-hover)' };
    case 'danger': return { bg: 'var(--danger)', bgHover: '#dc2626', fg: '#fff', border: 'transparent' };
    case 'primary':
    default:       return { bg: 'var(--slate-ink)', bgHover: '#222', fg: '#fff', border: 'transparent' };
  }
}

export function Button({
  variant = 'primary',
  size = 'md',
  tone,
  fullWidth = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const f = baseFill(variant);
  const sz = SIZES[size] ?? SIZES.md;
  const bg = tone ?? (hover ? f.bgHover : f.bg);
  const borderColor = hover && f.borderHover ? f.borderHover : f.border;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        width: fullWidth ? '100%' : 'auto',
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--fw-semibold)',
        fontSize: sz.fontSize,
        padding: sz.padding,
        color: tone ? '#fff' : f.fg,
        background: bg,
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transform: f.lift && hover && !disabled ? 'translateY(-1px)' : 'none',
        transition: 'background 0.2s, border-color 0.2s, transform 0.2s, opacity 0.2s',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
