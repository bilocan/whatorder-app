import type React from 'react';

export interface BadgeProps {
  children?: React.ReactNode;
  /** Show the pulsing accent dot. @default true */
  pulse?: boolean;
  style?: React.CSSProperties;
}

export function Badge(props: BadgeProps): JSX.Element;
