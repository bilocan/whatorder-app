import type { RestaurantMapPin } from '../components/RestaurantMap';

import { API_URL } from './apiUrl';

export async function fetchMapRestaurants(ids?: string[]): Promise<RestaurantMapPin[]> {
  const qs = ids?.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
  const res = await fetch(`${API_URL}/api/maps/restaurants${qs}`);
  if (!res.ok) throw new Error('Failed to load map restaurants');
  const data = await res.json() as { restaurants: RestaurantMapPin[] };
  return data.restaurants ?? [];
}

export function parseCustomerFromSearch(params: URLSearchParams): { lat: number; lng: number } | null {
  const lat = parseFloat(params.get('clat') ?? '');
  const lng = parseFloat(params.get('clng') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function parseIdsFromSearch(params: URLSearchParams): string[] {
  return (params.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
}
