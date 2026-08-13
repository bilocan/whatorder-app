import { API_URL } from './apiUrl';
import { jsonAuthHeaders } from './apiAuth';

export type DealKindParam = 'first-order' | 'window';

export type DealSlot = {
  dealId: string;
  kind: 'first_order' | 'window';
  discountType: 'percent' | 'fixed';
  discountValue: number;
  label: string;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  updatedAt: string | null;
};

export type DealHistory = DealSlot & {
  status: 'active' | 'paused' | 'ended';
  createdAt: string | null;
  endedAt: string | null;
  createdBy: string | null;
};

export type DealsResponse = {
  firstOrder: DealSlot | null;
  window: DealSlot | null;
  history: DealHistory[];
};

async function dealsRequest(
  path: string,
  init: RequestInit = {},
): Promise<DealsResponse> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: await jsonAuthHeaders(),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as DealsResponse;
}

export async function fetchDeals(businessId: string): Promise<DealsResponse> {
  return dealsRequest(`/api/businesses/${businessId}/deals`);
}

export async function putDeal(
  businessId: string,
  kind: DealKindParam,
  body: Record<string, unknown>,
): Promise<DealsResponse> {
  return dealsRequest(`/api/businesses/${businessId}/deals/${kind}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function pauseDeal(
  businessId: string,
  kind: DealKindParam,
  active: boolean,
): Promise<DealsResponse> {
  return dealsRequest(`/api/businesses/${businessId}/deals/${kind}/pause`, {
    method: 'POST',
    body: JSON.stringify({ active }),
  });
}

export async function endDeal(
  businessId: string,
  kind: DealKindParam,
): Promise<DealsResponse> {
  return dealsRequest(`/api/businesses/${businessId}/deals/${kind}/end`, {
    method: 'POST',
  });
}
