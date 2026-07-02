import React from 'react';

/**
 * Dashboard select — compact control on a light control fill with a custom
 * chevron (native arrow suppressed). Options passed as {value,label} pairs.
 */

export function Select({ options = [], value, onChange, ariaLabel, style, ...rest }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          background: 'var(--surface-control)',
          border: '1px solid var(--surface-border-strong)',
          borderRadius: 'var(--radius-sm)',
          padding: '0.35rem 2rem 0.35rem 0.6rem',
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
          outline: 'none',
          ...style,
        }}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          right: '0.5rem',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          fontSize: '0.6rem',
          color: 'var(--text-quiet)',
        }}
      >
        ▼
      </span>
    </span>
  );
}
