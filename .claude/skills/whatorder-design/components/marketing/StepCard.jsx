import React from 'react';

/**
 * Numbered feature step from the marketing "how it works" grid. Green step
 * label, tight heading, muted body — on a dark card that brightens on hover.
 */

export function StepCard({ step, title, children, style }) {
  const [h, setH] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: 'var(--bg-raised)',
        border: `1px solid ${h ? 'var(--border-hover)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-6)',
        transition: 'border-color 0.2s',
        ...style,
      }}
    >
      {step && (
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--fw-bold)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
            marginBottom: 'var(--space-4)',
          }}
        >
          {step}
        </div>
      )}
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-lg)',
          fontWeight: 'var(--fw-semibold)',
          letterSpacing: 'var(--tracking-tight)',
          color: 'var(--text)',
          marginBottom: '0.6rem',
        }}
      >
        {title}
      </h3>
      <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 'var(--lh-body)' }}>
        {children}
      </p>
    </div>
  );
}
