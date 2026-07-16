import type { OrderStatus } from '../types';
import { API_URL } from './apiUrl';
import { authHeaders, jsonAuthHeaders } from './apiAuth';

export type ActionVariant = 'primary' | 'danger';
export type ActionTone = 'preparing' | 'ready' | 'on_the_way' | 'delivered';

export type ActionButton = {
  labelKey: string;
  action: string;
  variant?: ActionVariant;
  tone?: ActionTone;
};

export const DEFAULT_APPROVE_ETA_MINUTES = 30;

export const ACTION_NEXT_STATUS: Record<string, OrderStatus> = {
  approve: 'approved',
  reject: 'rejected',
  prepare: 'preparing',
  ready: 'ready',
  'on-the-way': 'on_the_way',
  'picked-up': 'picked_up',
  delivered: 'delivered',
  cancel: 'cancelled',
};

export function getActionButtons(status: OrderStatus, orderType?: string): ActionButton[] {
  switch (status) {
    case 'pending':
      return [
        { labelKey: 'orderDetail.action.approve', action: 'approve', variant: 'primary' },
        { labelKey: 'orderDetail.action.reject', action: 'reject', variant: 'danger' },
      ];
    case 'approved':
      return [{ labelKey: 'orderDetail.action.prepare', action: 'prepare', tone: 'preparing' }];
    case 'preparing':
      return orderType === 'delivery'
        ? [{ labelKey: 'orderDetail.action.onTheWay', action: 'on-the-way', tone: 'on_the_way' }]
        : [{ labelKey: 'orderDetail.action.markReady', action: 'ready', tone: 'ready' }];
    case 'ready':
      return [{ labelKey: 'orderDetail.action.pickedUp', action: 'picked-up', tone: 'delivered' }];
    case 'on_the_way':
      return [{ labelKey: 'orderDetail.action.delivered', action: 'delivered', tone: 'delivered' }];
    default:
      return [];
  }
}

/** Primary lifecycle advance (excludes reject). */
export function getPrimaryAction(status: OrderStatus, orderType?: string): ActionButton | null {
  const buttons = getActionButtons(status, orderType);
  return buttons.find((b) => b.action !== 'reject') ?? null;
}

export type PostOrderActionResult =
  | { ok: true; nextStatus: OrderStatus }
  | { ok: false; error: string };

export async function postOrderAction(
  businessId: string,
  orderId: string,
  action: string,
  opts?: { etaMinutes?: number },
): Promise<PostOrderActionResult> {
  const headers = action === 'approve'
    ? await jsonAuthHeaders()
    : await authHeaders();
  const res = await fetch(`${API_URL}/api/businesses/${businessId}/orders/${orderId}/${action}`, {
    method: 'POST',
    headers,
    ...(action === 'approve' && {
      body: JSON.stringify({ etaMinutes: opts?.etaMinutes ?? DEFAULT_APPROVE_ETA_MINUTES }),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error ?? `Request failed (${res.status})` };
  }
  const nextStatus = ACTION_NEXT_STATUS[action];
  if (!nextStatus) return { ok: false, error: `Unknown action: ${action}` };
  return { ok: true, nextStatus };
}
