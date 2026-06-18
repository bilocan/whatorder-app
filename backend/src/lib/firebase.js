const admin = require('firebase-admin');

if (!admin.apps.length) {
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    ? admin.credential.cert(
        JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'))
      )
    : admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').replace(/\r/g, ''),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      });
  admin.initializeApp({ credential });
}

const db = admin.firestore();
db.settings({ preferRest: true });

module.exports = { admin, db };
