export interface BrandLogoProps {
  /** Mark size. sm=24px, md=32px, lg=48px. @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Show the "WhatOrder" wordmark next to the mark. @default true */
  showWordmark?: boolean;
  /** Which background the lockup sits on — sets wordmark text color. @default "light" */
  variant?: 'light' | 'dark';
  /** Green drop-shadow glow behind the mark (hero use on dark). @default false */
  glow?: boolean;
}

export function BrandLogo(props: BrandLogoProps): JSX.Element;
