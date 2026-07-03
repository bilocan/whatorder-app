import type React from 'react';

export interface PaymentBadgeProps {
  /** Payment state. @default "cash" */
  kind?: 'cash' | 'paid' | 'unpaid' | 'failed';
  /** Override the default English label. */
  label?: string;
  style?: React.CSSProperties;
}

export function PaymentBadge(props: PaymentBadgeProps): JSX.Element;
