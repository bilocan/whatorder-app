import React from 'react';

/**
 * WhatOrder brand lockup: the rounded-tile mark (menu lines + check) plus the
 * "WhatOrder" wordmark, where "Order" is set in brand green.
 * SVG paths are reproduced verbatim from the product's own logo asset.
 */

const ICON_PX = { sm: 24, md: 32, lg: 48 };
const FONT_REM = { sm: '0.95rem', md: '1.05rem', lg: '1.35rem' };

export function BrandLogo({
  size = 'md',
  showWordmark = true,
  variant = 'light',
  glow = false,
}) {
  const px = ICON_PX[size] ?? ICON_PX.md;
  const gid = React.useId ? React.useId().replace(/:/g, '') : 'wo';
  const wordColor = variant === 'dark' ? 'var(--ink-fg)' : 'var(--slate-ink)';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size === 'sm' ? '0.45rem' : '0.55rem' }}>
      <svg
        width={px}
        height={px}
        viewBox="0 0 48 48"
        fill="none"
        role="img"
        aria-label="WhatOrder"
        style={{ flexShrink: 0, filter: glow ? 'drop-shadow(var(--glow-accent))' : 'none' }}
      >
        <defs>
          <linearGradient id={`wo-${gid}`} x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--green-500)" />
            <stop offset="1" stopColor="var(--green-700)" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="40" height="40" rx="12" fill={`url(#wo-${gid})`} />
        <path d="M14 16h20M14 24h16M14 32h12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M30 30l3 3 6-7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showWordmark && (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 'var(--fw-semibold)',
            letterSpacing: 'var(--tracking-tight)',
            fontSize: FONT_REM[size] ?? FONT_REM.md,
            lineHeight: 1,
            color: wordColor,
          }}
        >
          What<span style={{ color: 'var(--green-500)' }}>Order</span>
        </span>
      )}
    </div>
  );
}
