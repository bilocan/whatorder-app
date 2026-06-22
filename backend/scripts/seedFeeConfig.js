require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { db } = require('../src/lib/firebase');

async function seed() {
  const ref = db.collection('config').doc('whatorder');
  const snap = await ref.get();
  if (snap.exists) {
    console.log('config/whatorder already exists:', snap.data());
    return;
  }
  const config = { feeType: 'percent', feeValue: 10 };
  await ref.set(config);
  console.log('Created config/whatorder:', config);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
