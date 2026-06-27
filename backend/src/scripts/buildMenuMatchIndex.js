/**
 * Build or refresh menuMatch index for a business (category aliases + typos).
 *
 * Usage:
 *   node src/scripts/buildMenuMatchIndex.js <businessId> [--dry-run] [--write]
 *
 * Example:
 *   node src/scripts/buildMenuMatchIndex.js biz_enes_kebap_9450w --write
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const { admin } = require('../lib/firebase');
const { businessRef, menuRef } = require('../lib/collections');
const { buildMenuMatchIndex } = require('../bot/menuMapper');

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const write = process.argv.includes('--write');
  const [businessId] = args;

  if (!businessId) {
    console.error('Usage: node buildMenuMatchIndex.js <businessId> [--dry-run] [--write]');
    process.exit(1);
  }

  const bizSnap = await businessRef(businessId).get();
  if (!bizSnap.exists) {
    console.error(`Business "${businessId}" not found`);
    process.exit(1);
  }

  const menuSnap = await menuRef(businessId).where('available', '==', true).get();
  const menuItems = menuSnap.docs.map(d => ({ ...d.data(), id: d.id }));
  const existing = bizSnap.data()?.menuMatch ?? null;
  const index = buildMenuMatchIndex(menuItems, existing);

  console.log(`Business: ${bizSnap.data().name} (${businessId})`);
  console.log(`Menu items: ${menuItems.length}`);
  console.log(`Categories indexed: ${Object.keys(index.categories).length}`);

  const preview = Object.entries(index.categories)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 8);
  for (const [cat, meta] of preview) {
    console.log(`\n  ${cat} (${meta.itemCount} items)`);
    console.log(`    normalized: ${meta.normalized}`);
    console.log(`    aliases: ${meta.aliases.slice(0, 6).join(', ')}${meta.aliases.length > 6 ? '…' : ''}`);
  }
  if (Object.keys(index.categories).length > preview.length) {
    console.log(`\n  … and ${Object.keys(index.categories).length - preview.length} more`);
  }

  if (dryRun || !write) {
    if (!write) {
      console.log('\nDry run — pass --write to persist on businesses/{bid}.menuMatch');
    }
    process.exit(0);
  }

  await businessRef(businessId).set({
    menuMatch: {
      ...index,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });

  console.log('\nSaved businesses/{bid}.menuMatch');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
