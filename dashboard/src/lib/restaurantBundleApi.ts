import { auth } from './firebase';
import { API_URL } from './apiUrl';
import { getFrontendBuildInfo } from './buildInfo';

const ENES_ID = 'biz_enes_kebap_9450w';

export type BundleProfile = 'setup' | 'full';

export type BundlePreview = {
  businessId: string;
  businessName: string;
  profile: BundleProfile;
  source?: { firebaseProject?: string; firestoreDatabase?: string };
  counts: Record<string, number>;
  exists: boolean;
  warnings: string[];
  pii?: boolean;
  importToken?: string;
  contentSha256?: string;
};

async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error || `Request failed (${res.status})`;
}

export async function exportRestaurantBundle(businessId: string, profile: BundleProfile) {
  const res = await fetch(`${API_URL}/admin/restaurants/${encodeURIComponent(businessId)}/export`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ url: string; checksum: string; counts: Record<string, number> }>;
}

export async function requestImportUpload() {
  const res = await fetch(`${API_URL}/admin/restaurants/import/upload-url`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ uploadUrl: string; importToken: string; objectKey: string }>;
}

export async function uploadBundleFile(uploadUrl: string, file: File) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export async function previewImportBundle(importToken: string) {
  const res = await fetch(`${API_URL}/admin/restaurants/import/preview`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ importToken }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<BundlePreview>;
}

export async function runImportBundle(opts: {
  importToken: string;
  overwrite?: boolean;
  keepBusinessId?: boolean;
  attachToPhoneLine?: boolean;
  targetPhoneNumberId?: string | null;
  confirmName?: string;
}) {
  const res = await fetch(`${API_URL}/admin/restaurants/import`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<{ businessId: string; counts: Record<string, number>; warnings: string[] }>;
}

export function needsNameConfirm(businessId: string | undefined, isProduction: boolean) {
  return isProduction || businessId === ENES_ID;
}

export function isProductionDashboard() {
  return getFrontendBuildInfo().environment === 'production';
}
