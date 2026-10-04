const { admin } = require('../firebase');
const { parseGsUrl } = require('./urls');

function contentTypeFor(objectPath) {
  const lower = String(objectPath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

function zipAssetName(objectPath) {
  return `assets/${String(objectPath || '').replace(/^\/+/, '')}`;
}

function objectPathFromZipName(name) {
  if (!name || !name.startsWith('assets/')) return null;
  return name.slice('assets/'.length);
}

function refKey(ref) {
  return `${ref.bucket || ''}::${ref.objectPath}`;
}

function collectStorageRefs(firestore, { profile } = {}) {
  const byKey = new Map();
  const addUrl = (url, kind) => {
    const parsed = parseGsUrl(url);
    if (!parsed || !parsed.objectPath) return;
    byKey.set(refKey(parsed), { ...parsed, kind });
  };
  const addPath = (objectPath, kind) => {
    if (!objectPath || typeof objectPath !== 'string') return;
    if (objectPath.startsWith('gs://') || objectPath.startsWith('https://')) {
      addUrl(objectPath, kind);
      return;
    }
    const ref = { bucket: null, objectPath, kind };
    byKey.set(refKey(ref), ref);
  };

  addUrl(firestore?.business?.imageUrl, 'cover');
  for (const doc of Object.values(firestore?.menu || {})) {
    addUrl(doc.photoUrl, 'menu');
  }
  if (profile === 'full') {
    for (const doc of Object.values(firestore?.receipts || {})) {
      addPath(doc.gcsPath, 'receipt');
      addUrl(doc.pdfUrl, 'receipt');
    }
  }
  return [...byKey.values()];
}

function remapObjectPath(objectPath, sourceBusinessId, targetBusinessId) {
  if (!objectPath || !sourceBusinessId || !targetBusinessId || sourceBusinessId === targetBusinessId) {
    return objectPath;
  }
  return objectPath
    .split(`menu-photos/${sourceBusinessId}/`).join(`menu-photos/${targetBusinessId}/`)
    .split(`businesses/${sourceBusinessId}/`).join(`businesses/${targetBusinessId}/`);
}

function assertContainedAssetPath(objectPath, targetBusinessId) {
  const path = String(objectPath || '').replace(/^\/+/, '');
  const bad = !targetBusinessId
    || !path
    || path.includes('..')
    || path.includes('\\')
    || path.includes('\0')
    || path.split('/').some((part) => part === '');
  const menuPrefix = `menu-photos/${targetBusinessId}/`;
  const businessPrefix = `businesses/${targetBusinessId}/`;
  const foreignTenant = path.includes('menu-photos/') || path.includes('businesses/');
  const allowed = path.startsWith(menuPrefix) || path.startsWith(businessPrefix) || !foreignTenant;
  if (bad || !allowed) {
    const err = new Error(`Asset path is outside the target restaurant: ${path || objectPath}`);
    err.status = 400;
    throw err;
  }
  return path;
}

function tenantBucket(name) {
  return name ? admin.storage().bucket(name) : admin.storage().bucket();
}

async function listMenuPhotoRefs(businessId) {
  if (!businessId) return [];
  try {
    const bucket = tenantBucket();
    const [files] = await bucket.getFiles({ prefix: `menu-photos/${businessId}/` });
    return (files || [])
      .filter((f) => f.name && !f.name.endsWith('/'))
      .map((f) => ({ bucket: bucket.name, objectPath: f.name, kind: 'menu' }));
  } catch {
    return [];
  }
}

const ASSET_IO_CONCURRENCY = 8;
const ASSET_IO_TIMEOUT_MS = 30_000;

async function eachLimit(items, limit, fn) {
  const list = items || [];
  if (!list.length) return;
  let cursor = 0;
  let failure = null;
  async function worker() {
    while (!failure && cursor < list.length) {
      const index = cursor;
      cursor += 1;
      try {
        await fn(list[index], index);
      } catch (err) {
        if (!failure) failure = err;
        return;
      }
    }
  }
  const workers = Math.min(limit, list.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (failure) throw failure;
}

async function downloadAssets(refs) {
  const assets = [];
  const skipped = [];
  const seen = new Set();
  const unique = [];
  for (const ref of refs || []) {
    if (!ref?.objectPath || seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    unique.push(ref);
  }
  await eachLimit(unique, ASSET_IO_CONCURRENCY, async (ref) => {
    try {
      const file = tenantBucket(ref.bucket).file(ref.objectPath);
      // Skip the extra metadata round trip. Photos live in us-west1 and Test
      // Cloud Run is europe-west3, so one call per file already dominates.
      const [buffer] = await file.download({
        validation: false,
        timeout: ASSET_IO_TIMEOUT_MS,
      });
      assets.push({
        name: zipAssetName(ref.objectPath),
        objectPath: ref.objectPath,
        contentType: contentTypeFor(ref.objectPath),
        buffer,
      });
    } catch {
      skipped.push(ref.objectPath);
    }
  });
  return { assets, skipped };
}

async function uploadAssets(assets, { sourceBusinessId, targetBusinessId } = {}) {
  const uploaded = [];
  const jobs = [];
  for (const asset of assets || []) {
    const objectPath = remapObjectPath(
      asset.objectPath || objectPathFromZipName(asset.name),
      sourceBusinessId,
      targetBusinessId,
    );
    if (!objectPath || !asset.buffer) continue;
    jobs.push({
      objectPath: assertContainedAssetPath(objectPath, targetBusinessId),
      asset,
    });
  }
  await eachLimit(jobs, ASSET_IO_CONCURRENCY, async ({ objectPath, asset }) => {
    await tenantBucket().file(objectPath).save(asset.buffer, {
      contentType: asset.contentType || contentTypeFor(objectPath),
      resumable: false,
      timeout: ASSET_IO_TIMEOUT_MS,
    });
    uploaded.push(objectPath);
  });
  return uploaded;
}

module.exports = {
  contentTypeFor,
  zipAssetName,
  objectPathFromZipName,
  collectStorageRefs,
  remapObjectPath,
  assertContainedAssetPath,
  listMenuPhotoRefs,
  downloadAssets,
  uploadAssets,
};
