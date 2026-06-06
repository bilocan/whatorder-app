require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
});

const db = admin.firestore();

async function testConnection() {
  try {
    console.log('Connecting to Firebase project:', process.env.FIREBASE_PROJECT_ID);
    await db.collection('_test').doc('ping').set({ ts: new Date().toISOString() });
    console.log('Write OK');
    const doc = await db.collection('_test').doc('ping').get();
    console.log('Read OK:', doc.data());
    await db.collection('_test').doc('ping').delete();
    console.log('Delete OK');
    console.log('\nFirebase connection verified successfully.');
  } catch (err) {
    console.error('\nFirebase connection FAILED:', err.message);
  } finally {
    process.exit(0);
  }
}

testConnection();
