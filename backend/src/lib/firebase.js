const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    credential = admin.credential.cert(
      JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'))
    );
  } else if (process.env.FIREBASE_PRIVATE_KEY) {
    credential = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/\r/g, ''),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    });
  } else {
    // Cloud Run / GCP: use the runtime service account via ADC (no key needed)
    credential = admin.credential.applicationDefault();
  }
  admin.initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID });
}

// Preprod runs against the named "preprod" database in the prod project so
// release candidates can never touch live customer data. Unset = (default).
const db = process.env.FIRESTORE_DATABASE_ID
  ? getFirestore(admin.app(), process.env.FIRESTORE_DATABASE_ID)
  : admin.firestore();
// grpc-js is broken on Node.js 24 — use REST as a workaround.
// Node.js 22 (Cloud Run) uses gRPC natively, which handles reconnections
// correctly and avoids the "Premature close" error on idle Cloud Run instances.
if (parseInt(process.versions.node, 10) >= 24) {
  db.settings({ preferRest: true });
}

module.exports = { admin, db };
