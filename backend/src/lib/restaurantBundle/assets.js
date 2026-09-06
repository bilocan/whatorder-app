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

async function downloadAssets(refs) {
  const assets = [];
  const skipped = [];
  const seen = new Set();
  for (const ref of refs || []) {
    if (!ref?.objectPath || seen.has(refKey(ref))) continue;
    seen.add(refKey(ref));
    try {
      const file = tenantBucket(ref.bucket).file(ref.objectPath);
      let contentType = contentTypeFor(ref.objectPath);
      try {
        const [metadata] = await file.getMetadata();
        if (metadata?.contentType) contentType = metadata.contentType;
      } catch {
        // download may still succeed
      }
      const [buffer] = await file.download();
      assets.push({
        name: zipAssetName(ref.objectPath),
        objectPath: ref.objectPath,
        contentType,
        buffer,
      });
    } catch (err) {
      const code = err.code || err.statusCode;
      if (code === 404 || code === '404') {
        skipped.push(ref.objectPath);
        continue;
      }
      skipped.push(ref.objectPath);
    }
  }
  return { assets, skipped };
}

async function uploadAssets(assets, { sourceBusinessId, targetBusinessId } = {}) {
  const uploaded = [];
  for (const asset of assets || []) {
    const objectPath = remapObjectPath(
      asset.objectPath || objectPathFromZipName(asset.name),
      sourceBusinessId,
      targetBusinessId,
    );
    if (!objectPath || !asset.buffer) continue;
    await tenantBucket().file(objectPath).save(asset.buffer, {
      contentType: asset.contentType || contentTypeFor(objectPath),
      resumable: false,
    });
    uploaded.push(objectPath);
  }
  return uploaded;
}

module.exports = {
  contentTypeFor,
  zipAssetName,
  objectPathFromZipName,
  collectStorageRefs,
  remapObjectPath,
  listMenuPhotoRefs,
  downloadAssets,
  uploadAssets,
};
