import type React from 'react';

export type OrderStatus =
  | 'pending' | 'approved' | 'preparing' | 'ready' | 'on_the_way'
  | 'picked_up' | 'delivered' | 'completed' | 'rejected' | 'cancelled';

export interface StatusBadgeProps {
  /** Order lifecycle status. @default "pending" */
  status?: OrderStatus;
  /** Override the default English label. */
  label?: string;
  style?: React.CSSProperties;
}

export function StatusBadge(props: StatusBadgeProps): JSX.Element;
