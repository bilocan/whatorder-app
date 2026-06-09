/**
 * One-time setup: saves a Meta catalog ID to a business Firestore doc so the
 * bot can send catalog messages to customers.
 *
 * Catalog item management (adding/editing products) must be done manually in
 * Meta Commerce Manager until the app has catalog_management permission
 * approved via App Review.
 *
 * Usage:
 *   node src/scripts/syncCatalog.js <businessId> <catalogId>
 *
 * Example:
 *   node src/scripts/syncCatalog.js biz_test 2600814597001682
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.dev') });
const { db } = require('../lib/firebase');

async function main() {
  const [businessId, catalogId] = process.argv.slice(2);
  if (!businessId || !catalogId) {
    console.error('Usage: node syncCatalog.js <businessId> <catalogId>');
    process.exit(1);
  }

  const ref = db.collection('businesses').doc(businessId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Business "${businessId}" not found in Firestore`);
    process.exit(1);
  }

  await ref.update({ catalogId });
  console.log(`✅ catalogId ${catalogId} saved to businesses/${businessId}`);
  console.log('The bot will now send catalog messages to customers.');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
