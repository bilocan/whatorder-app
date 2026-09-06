const crypto = require('crypto');
const { loadTenant } = require('./loadTenant');
const { persistImport } = require('./persistImport');
const { applyImport } = require('./applyImport');
const { currentEnv, isProductionTarget } = require('./bundleKey');
const { rejectRawGcsPath, createImportToken, assertPreviewChecksum, sha256Buffer } = require('./importToken');
const {
  packBundleToStream,
  unpackBundleFromBuffer,
  countsFromFirestore,
  checksumJson,
} = require('./zipBundle');
const {
  collectStorageRefs,
  listMenuPhotoRefs,
  downloadAssets,
} = require('./assets');
const {
  createExportUpload,
  createImportUpload,
  openImportObject,
  signedReadUrl,
  deleteObject,
} = require('./gcsBundle');

async function exportRestaurantBundle({ businessId, profile, adminUid }) {
  if (profile !== 'setup' && profile !== 'full') {
    const err = new Error('profile must be setup or full');
    err.status = 400;
    throw err;
  }
  const firestore = await loadTenant(businessId, profile);
  const env = currentEnv();
  const listed = await listMenuPhotoRefs(businessId);
  const { assets, skipped } = await downloadAssets([
    ...collectStorageRefs(firestore, { profile }),
    ...listed,
  ]);
  const bundle = {
    manifest: {
      schemaVersion: 1,
      profile,
      businessId,
      businessName: firestore.business?.name || businessId,
      exportedAt: new Date().toISOString(),
      source: env,
      skippedAssets: skipped,
    },
    firestore,
    assets,
  };
  const bundleId = `${businessId}-${profile}-${Date.now()}`;
  const { objectKey, file } = await createExportUpload({ adminUid, bundleId });
  const writeStream = file.createWriteStream({
    resumable: false,
    contentType: 'application/zip',
    metadata: {
      contentType: 'application/zip',
      metadata: { uploadedBy: adminUid },
    },
  });
  await packBundleToStream(bundle, writeStream);
  const url = await signedReadUrl(objectKey);
  return {
    url,
    objectKey,
    checksum: checksumJson(bundle.manifest),
    counts: {
      ...countsFromFirestore(firestore, profile),
      assets: assets.length,
    },
  };
}

async function startImportUpload({ adminUid }) {
  return createImportUpload({ adminUid });
}

function previewWarnings(bundle, { exists, targetEnv }) {
  const warnings = [];
  if (exists) warnings.push('Restaurant id already exists; import requires overwrite.');
  const source = bundle.manifest.source || {};
  if (source.firebaseProject !== targetEnv.firebaseProject
    || source.firestoreDatabase !== targetEnv.firestoreDatabase) {
    warnings.push('Cross-environment import: Stripe Connect, catalogId, and pending payouts will be stripped.');
    if (targetEnv.firebaseProject === 'whatorder-fire-prod') {
      warnings.push('Owner phones will be created in this project\'s Firebase Auth (Preprod shares Prod Auth).');
    }
  }
  if (bundle.manifest.profile === 'full') {
    warnings.push('Full profile includes customer phones, addresses, and Belege (personal data).');
  }
  const hasPhotos = Boolean(bundle.firestore?.business?.imageUrl)
    || Object.values(bundle.firestore?.menu || {}).some((d) => d.photoUrl);
  if (hasPhotos && !(bundle.assets || []).length) {
    warnings.push('ZIP has no photo files; rewritten image URLs may 404 on the target bucket.');
  }
  return warnings;
}

async function previewImportBundle({ importToken, adminUid, body }) {
  rejectRawGcsPath(body || {});
  const { buffer, objectKey, tokenPayload } = await openImportObject({ importToken, adminUid });
  const bundle = await unpackBundleFromBuffer(buffer);
  const env = currentEnv();
  const { businessRef } = require('../collections');
  const existing = await businessRef(bundle.manifest.businessId).get();
  const contentSha256 = sha256Buffer(buffer);
  const commitToken = createImportToken({
    adminUid,
    objectKey,
    firestoreDatabaseId: tokenPayload.firestoreDatabaseId,
    contentSha256,
  });
  return {
    businessId: bundle.manifest.businessId,
    businessName: bundle.manifest.businessName || bundle.firestore.business?.name,
    profile: bundle.manifest.profile,
    source: bundle.manifest.source,
    counts: {
      ...countsFromFirestore(bundle.firestore, bundle.manifest.profile),
      assets: (bundle.assets || []).length,
    },
    exists: existing.exists,
    warnings: previewWarnings(bundle, { exists: existing.exists, targetEnv: env }),
    pii: bundle.manifest.profile === 'full' || Boolean(bundle.firestore.business?.legal?.iban),
    importToken: commitToken,
    contentSha256,
  };
}

async function runImportBundle({
  importToken, adminUid, body = {},
}) {
  rejectRawGcsPath(body);
  const {
    keepBusinessId = true,
    overwrite = false,
    attachToPhoneLine = false,
    targetPhoneNumberId = null,
    confirmName,
    newBusinessId,
  } = body;
  if (attachToPhoneLine && !targetPhoneNumberId) {
    const err = new Error('attachToPhoneLine requires targetPhoneNumberId');
    err.status = 400;
    throw err;
  }
  const { buffer, objectKey, tokenPayload } = await openImportObject({ importToken, adminUid });
  assertPreviewChecksum(tokenPayload, buffer);
  const bundle = await unpackBundleFromBuffer(buffer);
  const env = currentEnv();
  const { businessRef } = require('../collections');
  const targetId = keepBusinessId === false
    ? (newBusinessId || `biz_import_${crypto.randomBytes(3).toString('hex')}`)
    : bundle.manifest.businessId;
  const existingSnap = await businessRef(targetId).get();
  const existing = {
    business: existingSnap.exists ? existingSnap.data() : null,
    menu: {},
    optionGroups: {},
    deals: {},
    intentLearnings: {},
    seededIntents: {},
    orders: {},
    customers: {},
    receipts: {},
  };
  const result = applyImport({
    bundle,
    existing,
    options: {
      overwrite,
      keepBusinessId,
      newBusinessId: targetId,
      attachToPhoneLine,
      targetPhoneNumberId,
      confirmName,
      isProduction: isProductionTarget(env),
    },
    targetEnv: env,
  });
  await persistImport(result, {
    profile: bundle.manifest.profile,
    overwrite,
    attachToPhoneLine,
    targetPhoneNumberId,
    assets: bundle.assets || [],
    sourceBusinessId: bundle.manifest.businessId,
  });
  await deleteObject(objectKey).catch(() => {});
  return {
    businessId: result.targetBusinessId,
    counts: countsFromFirestore(result, bundle.manifest.profile),
    warnings: previewWarnings(bundle, { exists: existingSnap.exists, targetEnv: env }),
  };
}

module.exports = {
  exportRestaurantBundle,
  startImportUpload,
  previewImportBundle,
  runImportBundle,
};
