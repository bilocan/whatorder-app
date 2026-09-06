const { admin } = require('../firebase');
const { currentEnv, bundleObjectKey, assertKeyMatchesCurrentEnv } = require('./bundleKey');
const { createImportToken, verifyImportToken } = require('./importToken');

const SIGNED_TTL_MS = 15 * 60 * 1000;

function bundleBucket() {
  const name = process.env.RESTAURANT_BUNDLE_BUCKET
    || (process.env.FIREBASE_PROJECT_ID
      ? `${process.env.FIREBASE_PROJECT_ID}-backups`
      : null);
  if (name) {
    try {
      return admin.storage().bucket(name);
    } catch {
      // fall through to default app bucket
    }
  }
  return admin.storage().bucket();
}

function fileFor(objectKey) {
  return bundleBucket().file(objectKey);
}

async function signedReadUrl(objectKey) {
  const [url] = await fileFor(objectKey).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + SIGNED_TTL_MS,
  });
  return url;
}

async function signedWriteUrl(objectKey) {
  const [url] = await fileFor(objectKey).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + SIGNED_TTL_MS,
    contentType: 'application/zip',
  });
  return url;
}

async function createExportUpload({ adminUid, bundleId }) {
  const env = currentEnv();
  const objectKey = bundleObjectKey({
    adminUid,
    bundleId,
    firestoreDatabaseId: env.firestoreDatabase,
  });
  return { objectKey, file: fileFor(objectKey) };
}

async function createImportUpload({ adminUid }) {
  const env = currentEnv();
  const bundleId = `in-${Date.now()}`;
  const objectKey = bundleObjectKey({
    adminUid,
    bundleId,
    firestoreDatabaseId: env.firestoreDatabase,
  });
  const uploadUrl = await signedWriteUrl(objectKey);
  const importToken = createImportToken({
    adminUid,
    objectKey,
    firestoreDatabaseId: env.firestoreDatabase,
  });
  return { objectKey, uploadUrl, importToken };
}

async function openImportObject({ importToken, adminUid }) {
  const env = currentEnv();
  const payload = verifyImportToken(importToken, {
    adminUid,
    firestoreDatabaseId: env.firestoreDatabase,
  });
  const parsed = assertKeyMatchesCurrentEnv(payload.objectKey, env);
  if (parsed.adminUid !== adminUid) {
    const err = new Error('Bundle was uploaded by another admin');
    err.status = 403;
    throw err;
  }
  const file = fileFor(payload.objectKey);
  let metadata;
  try {
    [metadata] = await file.getMetadata();
  } catch {
    metadata = null;
  }
  const uploadedBy = metadata?.metadata?.uploadedBy;
  if (uploadedBy && uploadedBy !== adminUid) {
    const err = new Error('Bundle was uploaded by another admin');
    err.status = 403;
    throw err;
  }
  const [buf] = await file.download();
  return { file, objectKey: payload.objectKey, buffer: buf };
}

async function deleteObject(objectKey) {
  await fileFor(objectKey).delete({ ignoreNotFound: true });
}

module.exports = {
  SIGNED_TTL_MS,
  bundleBucket,
  fileFor,
  signedReadUrl,
  signedWriteUrl,
  createExportUpload,
  createImportUpload,
  openImportObject,
  deleteObject,
};
