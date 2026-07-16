interface PaymentBadgeProps {
  kind: 'cash' | 'paid' | 'unpaid' | 'failed';
  label: string;
}

/** Payment-state pill — same translucent-fill treatment as StatusBadge. */
export default function PaymentBadge({ kind, label }: PaymentBadgeProps) {
  return (
    <span className="badge-pill payment-badge" data-kind={kind}>
      {label}
    </span>
  );
}
