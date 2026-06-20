#!/usr/bin/env node
// Dev helper: seed sample optionGroups when menu items have none yet.
// Owners should configure customizations in the dashboard (Menu → edit item).
//
// Usage:
//   node src/scripts/seedOptionGroups.js <businessId>

require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local') });
require('../lib/firebase'); // initialise admin SDK
const { menuRef } = require('../lib/collections');

const businessId = process.argv[2];
if (!businessId) {
  console.error('Usage: node seedOptionGroups.js <businessId>');
  process.exit(1);
}

const SAMPLE_OPTION_GROUPS = [
  {
    id: 'protein',
    label: 'Protein',
    type: 'single',
    required: true,
    options: [
      { id: 'chicken', label: 'Chicken' },
      { id: 'lamb',    label: 'Lamb'    },
      { id: 'mixed',   label: 'Mixed'   },
    ],
  },
  {
    id: 'sauce',
    label: 'Sauce',
    type: 'multi',
    required: false,
    options: [
      { id: 'garlic', label: 'Garlic sauce' },
      { id: 'chili',  label: 'Chili sauce'  },
      { id: 'none',   label: 'No sauce'     },
    ],
  },
  {
    id: 'inserts',
    label: 'Inserts',
    type: 'multi',
    required: false,
    multiDefault: 'all',
    options: [
      { id: 'tomato', label: 'Tomato' },
      { id: 'salad',  label: 'Salad'  },
      { id: 'onion',  label: 'Onion'  },
    ],
  },
];

async function run() {
  const snap = await menuRef(businessId).get();
  if (snap.empty) {
    console.log('No menu items found for business:', businessId);
    process.exit(0);
  }

  let updated = 0, skipped = 0;
  for (const doc of snap.docs) {
    if (doc.data().optionGroups) {
      console.log(`  skip  ${doc.id} (${doc.data().name}) — already has optionGroups`);
      skipped++;
      continue;
    }
    await doc.ref.update({ optionGroups: SAMPLE_OPTION_GROUPS });
    console.log(`  added ${doc.id} (${doc.data().name})`);
    updated++;
  }

  console.log(`\nDone — ${updated} updated, ${skipped} skipped.`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
