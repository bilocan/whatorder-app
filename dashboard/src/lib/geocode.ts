import { auth } from './firebase';

import { API_URL } from './apiUrl';

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${API_URL}/api/geocode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ address }),
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Geocode error: ${res.status}`);

  const data = await res.json() as { lat?: number; lng?: number };
  if (data.lat == null || data.lng == null) return null;
  return { lat: data.lat, lng: data.lng };
}
