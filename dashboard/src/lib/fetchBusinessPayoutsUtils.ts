import type { Payout } from '../types';

export function sortByPaidAtDesc(rows: Payout[]): Payout[] {
  return [...rows].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());
}

export function isIndexNotReadyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  return code === 'failed-precondition' || /requires an index|failed-precondition/i.test(msg);
}
