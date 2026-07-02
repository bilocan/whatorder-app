import React from 'react';

/**
 * Text input. Adapts to surface: `light` (dashboard — #ddd border on white)
 * or `dark` (marketing — raised bg, green focus ring). Focus tints the border.
 */

export function Input({
  surface = 'light',
  label,
  id,
  style,
  wrapperStyle,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const dark = surface === 'dark';

  const borderColor = focus
    ? (dark ? 'rgba(34,197,94,0.5)' : 'var(--green-500)')
    : (dark ? 'var(--border)' : 'var(--input-border)');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', ...wrapperStyle }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            fontWeight: dark ? 'var(--fw-medium)' : 'var(--fw-semibold)',
            color: dark ? 'var(--text-muted)' : 'var(--text-strong)',
          }}
        >
          {label}
        </label>
      )}
      <input
        id={id}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'var(--font-sans)',
          fontSize: dark ? '0.95rem' : 'var(--text-md)',
          padding: dark ? '0.75rem 1rem' : '0.65rem',
          color: dark ? 'var(--text)' : 'var(--text-body)',
          background: dark ? 'var(--bg-raised)' : 'var(--surface)',
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          transition: 'border-color 0.2s',
          ...style,
        }}
        {...rest}
      />
    </div>
  );
}
