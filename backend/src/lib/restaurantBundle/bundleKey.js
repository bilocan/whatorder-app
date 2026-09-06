function currentFirestoreDatabaseId() {
  return process.env.FIRESTORE_DATABASE_ID || 'default';
}

function currentEnv() {
  return {
    firebaseProject: process.env.FIREBASE_PROJECT_ID || '',
    firestoreDatabase: currentFirestoreDatabaseId(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    deployEnv: process.env.DEPLOY_ENV || '',
    stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : 'test',
  };
}

function isProductionTarget(env = currentEnv()) {
  return env.deployEnv === 'production'
    || (env.firebaseProject === 'whatorder-fire-prod' && env.firestoreDatabase === 'default');
}

function bundleObjectKey({ adminUid, bundleId, firestoreDatabaseId = currentFirestoreDatabaseId() }) {
  if (!adminUid || !bundleId) {
    throw new Error('adminUid and bundleId are required');
  }
  return `restaurant-bundles/${firestoreDatabaseId}/${adminUid}/${bundleId}.zip`;
}

function parseBundleObjectKey(objectKey) {
  const parts = String(objectKey || '').split('/');
  if (parts.length !== 4 || parts[0] !== 'restaurant-bundles') {
    return null;
  }
  return {
    firestoreDatabaseId: parts[1],
    adminUid: parts[2],
    bundleId: parts[3].replace(/\.zip$/, ''),
  };
}

function assertKeyMatchesCurrentEnv(objectKey, env = currentEnv()) {
  const parsed = parseBundleObjectKey(objectKey);
  if (!parsed) {
    const err = new Error('Invalid bundle object key');
    err.status = 400;
    throw err;
  }
  if (parsed.firestoreDatabaseId !== env.firestoreDatabase) {
    const err = new Error('Bundle key does not match this environment');
    err.status = 403;
    throw err;
  }
  return parsed;
}

module.exports = {
  currentFirestoreDatabaseId,
  currentEnv,
  isProductionTarget,
  bundleObjectKey,
  parseBundleObjectKey,
  assertKeyMatchesCurrentEnv,
};
