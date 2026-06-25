type BrandLogoProps = {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  variant?: 'light' | 'dark';
};

const ICON_PX = { sm: 24, md: 32, lg: 48 } as const;
const FONT_REM = { sm: '0.95rem', md: '1.05rem', lg: '1.35rem' } as const;

export default function BrandLogo({
  size = 'md',
  showWordmark = true,
  variant = 'light',
}: BrandLogoProps) {
  const src = variant === 'dark' ? '/assets/logo-mark.svg' : '/assets/logo-mark-light.svg';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size === 'sm' ? '0.45rem' : '0.55rem' }}>
      <img
        src={src}
        alt=""
        width={ICON_PX[size]}
        height={ICON_PX[size]}
        aria-hidden
        style={{ flexShrink: 0 }}
      />
      {showWordmark && (
        <span
          style={{
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontSize: FONT_REM[size],
            lineHeight: 1,
            color: variant === 'dark' ? '#E8E8E8' : '#0A0A0A',
          }}
        >
          What<span style={{ color: '#22C55E' }}>Order</span>
        </span>
      )}
    </div>
  );
}
