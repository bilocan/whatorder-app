import { auth } from './firebase';

/** Bearer token for dashboard → backend API calls. */
export async function authHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

export async function jsonAuthHeaders(): Promise<HeadersInit> {
  return authHeaders({ 'Content-Type': 'application/json' });
}
