/** Locale-aware payout timestamp (matches admin Earnings page). */
export function formatPayoutDate(iso: string): string {
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
