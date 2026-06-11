require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { db } = require('../src/lib/firebase');
const { FieldValue } = require('firebase-admin/firestore');

async function migrate() {
  const snap = await db.collection('businesses').get();
  if (snap.empty) {
    console.log('No business documents found.');
    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const update = {};

    if (data.phone !== undefined) {
      update.alertPhone = data.phone;
      update.phone = FieldValue.delete();
    }

    if (data.whatsappNumber !== undefined) {
      update.whatsappNumber = FieldValue.delete();
    }

    if (Object.keys(update).length === 0) {
      console.log(`  skip  ${docSnap.id} — already migrated`);
      skipped++;
      continue;
    }

    await docSnap.ref.update(update);
    console.log(`  migrated  ${docSnap.id}  phone="${data.phone ?? '(null)'}" → alertPhone`);
    migrated++;
  }

  console.log(`\nDone. ${migrated} migrated, ${skipped} skipped.`);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
