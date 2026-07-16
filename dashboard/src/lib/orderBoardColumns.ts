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

/**
 * When the order entered a terminal status (not when it was placed).
 */
export function terminalCompletedAtMs(order: Order): number | null {
  const stamps = [
    order.deliveredAt,
    order.pickedUpAt,
    order.completedAt,
    order.rejectedAt,
    order.cancelledAt,
    order.updatedAt,
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

/** Terminal orders completed on the current local calendar day. */
export function isCompletedToday(order: Order, nowMs = Date.now()): boolean {
  const completedAt = terminalCompletedAtMs(order);
  if (completedAt === null) return false;
  return completedAt >= startOfLocalDayMs(nowMs);
}
