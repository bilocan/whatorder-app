import type { Order, OrderStatus } from '../types';

const STATUS_RANK: Record<OrderStatus, number> = {
  pending: 0,
  approved: 1,
  preparing: 2,
  ready: 3,
  on_the_way: 3,
  picked_up: 4,
  delivered: 4,
  completed: 4,
  rejected: 4,
  cancelled: 4,
};

const TERMINAL_STAMP_FIELDS = [
  'deliveredAt',
  'pickedUpAt',
  'rejectedAt',
  'cancelledAt',
  'completedAt',
] as const;

export type OrderOptimisticPatch = {
  status: OrderStatus;
  deliveredAt?: string;
  pickedUpAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
};

export function stampTerminalFields(status: OrderStatus, atIso: string): OrderOptimisticPatch {
  const patch: OrderOptimisticPatch = { status };
  if (status === 'delivered') patch.deliveredAt = atIso;
  if (status === 'picked_up') patch.pickedUpAt = atIso;
  if (status === 'rejected') patch.rejectedAt = atIso;
  if (status === 'cancelled') patch.cancelledAt = atIso;
  if (status === 'completed') patch.completedAt = atIso;
  return patch;
}

function fillMissingStamps(remote: Order, patch: OrderOptimisticPatch): Order {
  const next = { ...remote };
  for (const field of TERMINAL_STAMP_FIELDS) {
    if (patch[field] && !remote[field]) next[field] = patch[field];
  }
  return next;
}

/**
 * Merge one remote Firestore order with a local optimistic lifecycle patch.
 * Clear the patch once remote status has caught up (or moved ahead).
 */
export function applyOptimisticToRemote(
  remote: Order,
  patch: OrderOptimisticPatch | undefined,
): { order: Order; clearPatch: boolean } {
  if (!patch) return { order: remote, clearPatch: false };

  const remoteRank = STATUS_RANK[remote.status] ?? 0;
  const patchRank = STATUS_RANK[patch.status] ?? 0;

  if (remote.status === patch.status || remoteRank > patchRank) {
    return { order: fillMissingStamps(remote, patch), clearPatch: true };
  }

  return { order: { ...remote, ...patch }, clearPatch: false };
}

export function mergeOrdersWithOptimistic(
  remote: Order[],
  patches: Map<string, OrderOptimisticPatch>,
): { orders: Order[]; clearedIds: string[] } {
  const clearedIds: string[] = [];
  const orders = remote.map((r) => {
    const { order, clearPatch } = applyOptimisticToRemote(r, patches.get(r.id));
    if (clearPatch) clearedIds.push(r.id);
    return order;
  });
  return { orders, clearedIds };
}
