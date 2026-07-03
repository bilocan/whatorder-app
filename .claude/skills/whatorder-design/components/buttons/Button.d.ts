import type React from 'react';

export interface ButtonProps {
  /**
   * Visual style. `primary`=solid black (dashboard), `accent`=solid green
   * (marketing CTA), `ghost`=bordered transparent, `danger`=solid red.
   * @default "primary"
   */
  variant?: 'primary' | 'accent' | 'ghost' | 'danger';
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg';
  /** Override the fill with an explicit color — used for order-status action buttons (e.g. var(--status-preparing)). Renders white text. */
  tone?: string;
  /** Stretch to container width. @default false */
  fullWidth?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Button(props: ButtonProps): JSX.Element;
