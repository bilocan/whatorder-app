import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // WhatsApp's own image message limit

export class MenuPhotoError extends Error {
  constructor(public code: 'invalid-type' | 'too-large', message: string) {
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
