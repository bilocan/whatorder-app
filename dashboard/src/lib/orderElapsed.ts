import type { OrderStatus } from '../types';

const TERMINAL = new Set<OrderStatus>([
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
  'completed',
]);

export const NEW_ORDER_MAX_MINUTES = 4;

export type ElapsedUrgency = 'normal' | 'warn' | 'danger';

export type ElapsedInfo = {
  minutes: number;
  urgency: ElapsedUrgency;
  /** i18n key under orders.board.elapsed.* */
  labelKey: 'justNow' | 'minutesAgo' | 'hoursAgo';
  labelParams: { count?: number; hours?: number; minutes?: number };
  isNew: boolean;
};

export function orderElapsed(
  createdAtMs: number,
  status: OrderStatus,
  nowMs = Date.now(),
): ElapsedInfo {
  const minutes = Math.max(0, Math.round((nowMs - createdAtMs) / 60_000));
  let urgency: ElapsedUrgency = 'normal';
  if (!TERMINAL.has(status)) {
    if (minutes > 20) urgency = 'danger';
    else if (minutes > 10) urgency = 'warn';
  }

  let labelKey: ElapsedInfo['labelKey'];
  let labelParams: ElapsedInfo['labelParams'] = {};
  if (minutes < 1) {
    labelKey = 'justNow';
  } else if (minutes < 60) {
    labelKey = 'minutesAgo';
    labelParams = { count: minutes };
  } else {
    labelKey = 'hoursAgo';
    labelParams = { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  }

  const isNew = status === 'pending' && minutes <= NEW_ORDER_MAX_MINUTES;

  return { minutes, urgency, labelKey, labelParams, isNew };
}
