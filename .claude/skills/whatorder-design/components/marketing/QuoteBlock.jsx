import React from 'react';

/**
 * Testimonial block for the marketing site — italic quote on the page bg
 * inside a bordered panel, with a muted attribution line.
 */

export function QuoteBlock({ quote, author, style }) {
  return (
    <div
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-6)',
        ...style,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-lg)',
          fontStyle: 'italic',
          color: 'var(--text)',
          lineHeight: 'var(--lh-relaxed)',
          marginBottom: '1.2rem',
        }}
      >
        {quote}
      </p>
      <p style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
        {author}
      </p>
    </div>
  );
}
