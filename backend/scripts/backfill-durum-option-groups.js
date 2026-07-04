/**
 * One-time: add beilagen optionGroups to Dürüm and Sandwich special items
 * that were missing them.
 *
 * Usage (dry-run — default):
 *   node scripts/backfill-durum-option-groups.js
 *
 * Usage (write):
 *   node scripts/backfill-durum-option-groups.js --write
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { db } = require('../src/lib/firebase');

const BUSINESS_ID = 'biz_enes_kebap_9450w';

const ITEMS_TO_PATCH = ['enes-kebap-special-duerum', 'enes-kebap-special-sandwich'];

const BEILAGEN_GROUP = {
  id: 'beilagen',
  label: 'Beilagen',
  type: 'multi',
  required: false,
  options: [
    { id: 'tomaten', label: 'Tomaten' },
    { id: 'salad',   label: 'Salad'   },
    { id: 'zwiebel', label: 'Zwiebel' },
    { id: 'sauce',   label: 'Sauce'   },
  ],
  multiDefault: 'all',
};

async function main() {
  const write = process.argv.includes('--write');
  const menuCol = db.collection('businesses').doc(BUSINESS_ID).collection('menu');

  for (const itemId of ITEMS_TO_PATCH) {
    const ref = menuCol.doc(itemId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[SKIP] ${itemId} — not found in Firestore`);
      continue;
    }
    const data = snap.data();
    if (data.optionGroups?.length) {
      console.log(`[SKIP] ${itemId} — already has optionGroups`);
      continue;
    }
    console.log(`[PATCH] ${itemId} — adding beilagen group${write ? '' : ' (dry-run)'}`);
    if (write) {
      await ref.update({ optionGroups: [BEILAGEN_GROUP] });
      console.log(`       ✓ written`);
    }
  }

  if (!write) {
    console.log('\nDry-run complete. Run with --write to apply changes.');
  } else {
    console.log('\nDone.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
