import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // WhatsApp's own image message limit

/** Meta Flow list-image max (decoded). Keep in sync with backend flowImages.js. */
export const FLOW_LIST_IMAGE_MAX_BYTES = 100 * 1024;
export const FLOW_LIST_THUMB_SIZE = 96;
export const FLOW_LIST_JPEG_QUALITY = 0.7;

export class MenuPhotoError extends Error {
  constructor(public code: 'invalid-type' | 'too-large' | 'thumb-failed', message: string) {
    super(message);
  }
}

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function menuPhotoStoragePath(businessId: string, fileName: string): string {
  return `menu-photos/${businessId}/${randomId()}-${fileName}`;
}

/** Strip data-URL prefix; return raw Base64 or null if invalid/oversized. */
export function normalizeFlowListImageBase64(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const dataIdx = s.indexOf('base64,');
  if (s.startsWith('data:') && dataIdx !== -1) {
    s = s.slice(dataIdx + 'base64,'.length);
  }
  if (!s || s.startsWith('data:')) return null;
  const approxBytes = Math.floor((s.length * 3) / 4);
  if (approxBytes > FLOW_LIST_IMAGE_MAX_BYTES || s.length > FLOW_LIST_IMAGE_MAX_BYTES) return null;
  return s;
}

/**
 * Build a Meta Flow list thumb (96×96 JPEG, raw Base64) from a local File.
 * Call only when the owner picked a new photoFile — do not fetch existing photoUrl (CORS).
 */
export async function flowListImageFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new MenuPhotoError('invalid-type', 'Selected file is not an image.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new MenuPhotoError('thumb-failed', 'Could not read image for Flow thumb.');
  }
  try {
    const size = FLOW_LIST_THUMB_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new MenuPhotoError('thumb-failed', 'Canvas unavailable for Flow thumb.');

    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    const dx = (size - dw) / 2;
    const dy = (size - dh) / 2;
    ctx.drawImage(bitmap, dx, dy, dw, dh);

    const dataUrl = canvas.toDataURL('image/jpeg', FLOW_LIST_JPEG_QUALITY);
    const b64 = normalizeFlowListImageBase64(dataUrl);
    if (!b64) {
      throw new MenuPhotoError('thumb-failed', 'Flow thumb exceeded Meta size limit.');
    }
    return b64;
  } finally {
    bitmap.close();
  }
}

export async function uploadMenuPhoto(businessId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new MenuPhotoError('invalid-type', 'Selected file is not an image.');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new MenuPhotoError('too-large', 'Image must be 5MB or smaller.');
  }
  const path = menuPhotoStoragePath(businessId, file.name);
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

export async function deleteMenuPhotoBestEffort(url: string): Promise<void> {
  try {
    await deleteObject(ref(storage, url));
  } catch {
    // non-fatal — stale Storage object, not worth failing the save for
  }
}
