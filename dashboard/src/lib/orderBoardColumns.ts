import type { Order, OrderStatus } from '../types';
import { toDate } from '../types';

export type BoardColumnKey = 'new' | 'preparing' | 'delivery' | 'done';

export type BoardColumnDef = {
  key: BoardColumnKey;
  labelKey: string;
  /** CSS custom property name for the column accent */
  colorToken: string;
};

/** Active kitchen board: New → Preparing → Delivery → Done (today only). */
export const ACTIVE_BOARD_COLUMNS: BoardColumnDef[] = [
  { key: 'new', labelKey: 'orders.board.col.new', colorToken: 'var(--status-pending)' },
  { key: 'preparing', labelKey: 'orders.board.col.preparing', colorToken: 'var(--status-preparing)' },
  { key: 'delivery', labelKey: 'orders.board.col.delivery', colorToken: 'var(--status-on-the-way)' },
  { key: 'done', labelKey: 'orders.board.col.done', colorToken: 'var(--status-delivered)' },
];

export function boardColumnForStatus(status: OrderStatus): BoardColumnKey {
  switch (status) {
    case 'pending':
      return 'new';
    case 'approved':
    case 'preparing':
      return 'preparing';
    case 'ready':
    case 'on_the_way':
      return 'delivery';
    default:
      return 'done';
  }
}

export function groupOrdersByColumn(orders: Order[]): Record<BoardColumnKey, Order[]> {
  const groups: Record<BoardColumnKey, Order[]> = {
    new: [],
    preparing: [],
    delivery: [],
    done: [],
  };
  for (const order of orders) {
    groups[boardColumnForStatus(order.status)].push(order);
  }
  return groups;
}

export function startOfLocalDayMs(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local calendar day as `YYYY-MM-DD` (for `<input type="date">` / URL params). */
export function localDayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isOnLocalDay(ms: number, dayKey: string): boolean {
  return localDayKey(ms) === dayKey;
}

/**
 * When the order entered a terminal status (not when it was placed).
 * Do not use `updatedAt` — payment/settlement touches would pull old orders onto "today".
 */
export function terminalCompletedAtMs(order: Order): number | null {
  const stamps = [
    order.deliveredAt,
    order.pickedUpAt,
    order.completedAt,
    order.rejectedAt,
    order.cancelledAt,
  ];
  let best: number | null = null;
  for (const stamp of stamps) {
    if (stamp == null || stamp === '') continue;
    const ms = toDate(stamp as Order['createdAt']).getTime();
    if (!Number.isFinite(ms)) continue;
    if (best === null || ms > best) best = ms;
  }
  return best;
}

/** Terminal orders completed on the given local calendar day (`YYYY-MM-DD`). */
export function isCompletedOnDay(order: Order, dayKey: string): boolean {
  const completedAt = terminalCompletedAtMs(order);
  if (completedAt === null) return false;
  return isOnLocalDay(completedAt, dayKey);
}

/** Terminal orders completed on the current local calendar day. */
export function isCompletedToday(order: Order, nowMs = Date.now()): boolean {
  return isCompletedOnDay(order, localDayKey(nowMs));
}

/**
 * Kitchen board for one local day: orders **placed** that day (open or terminal).
 * Day picker + elapsed time both key off `createdAt`.
 */
export function belongsToBoardDay(order: Order, dayKey: string): boolean {
  return isOnLocalDay(toDate(order.createdAt).getTime(), dayKey);
}
