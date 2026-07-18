import type { OrderStatus } from '../types';

interface StatusBadgeProps {
  status: OrderStatus | string;
  label: string;
}

/** Order-status pill — lifecycle hue on translucent fill (whatorder-design). */
export default function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className="badge-pill status-badge" data-status={status}>
      {label}
    </span>
  );
}
