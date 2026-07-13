/**
 * Backfill de/tr/en search aliases on existing menu items.
 *
 * Usage:
 *   node src/scripts/buildMenuItemAliases.js <businessId> [--dry-run] [--write]
 *
 * Example:
 *   node src/scripts/buildMenuItemAliases.js biz_enes_kebap_9450w --write
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const { admin, db } = require('../lib/firebase');
const { menuRef } = require('../lib/collections');
const { suggestItemAliases } = require('../bot/menuItemAliases');

const BATCH_SIZE = 400;

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const write = process.argv.includes('--write');
  const [businessId] = args;

  if (!businessId) {
    console.error('Usage: node buildMenuItemAliases.js <businessId> [--dry-run] [--write]');
    process.exit(1);
  }

  const menuSnap = await menuRef(businessId).get();
  if (menuSnap.empty) {
    console.error(`No menu items for "${businessId}"`);
    process.exit(1);
  }

  const updates = menuSnap.docs.map(doc => {
    const data = doc.data();
    const aliases = suggestItemAliases(data.name, { manual: data.aliases ?? [] });
    return { id: doc.id, name: data.name, aliases };
  });

  console.log(`Business: ${businessId}`);
  console.log(`Items: ${updates.length}`);
  updates.slice(0, 5).forEach(row => {
    console.log(`  ${row.name}`);
    console.log(`    aliases (${row.aliases.length}): ${row.aliases.slice(0, 5).join(', ')}${row.aliases.length > 5 ? '…' : ''}`);
  });
  if (updates.length > 5) console.log(`  … and ${updates.length - 5} more`);

  if (dryRun || !write) {
    console.log(write ? '' : '\nDry run — pass --write to persist aliases on menu docs');
    process.exit(0);
  }

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    // db.batch() so batch and menuRef target the same (possibly named) database
    const batch = db.batch();
    updates.slice(i, i + BATCH_SIZE).forEach(({ id, aliases }) => {
      batch.update(menuRef(businessId).doc(id), {
        aliases,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }

  console.log('\nSaved aliases on all menu items');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
