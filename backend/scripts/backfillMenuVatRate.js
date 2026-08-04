/**
 * Backfill missing menu VAT rates.
 *
 * Targets the Firebase project in backend/.env.local (FIREBASE_PROJECT_ID +
 * credentials; optional FIRESTORE_DATABASE_ID for named DBs like preprod).
 * Record each env run in vault:
 *   Projects/WhatOrder/notes/ops-firestore-data-migrations.md
 *
 * Usage (dry-run by default):
 *   node scripts/backfillMenuVatRate.js <businessId>
 *   node scripts/backfillMenuVatRate.js --all
 *
 * Options:
 *   --write      Persist the proposed VAT rates
 *   --drinks-20  Use 20% for drink categories (drinks / Getränke / Getraenke); else 10%
 */

const USAGE =
  'Usage: node scripts/backfillMenuVatRate.js <businessId>|--all [--write] [--drinks-20]';

function parseArgs(args) {
  const allowedFlags = new Set(['--all', '--write', '--drinks-20']);
  const unknownFlags = args.filter((arg) => arg.startsWith('--') && !allowedFlags.has(arg));
  const businessIds = args.filter((arg) => !arg.startsWith('--'));
  const all = args.includes('--all');

  if (unknownFlags.length > 0) {
    throw new Error(`Unknown option: ${unknownFlags[0]}\n${USAGE}`);
  }
  if ((all && businessIds.length > 0) || (!all && businessIds.length !== 1)) {
    throw new Error(USAGE);
  }

  return {
    all,
    businessId: all ? null : businessIds[0],
    write: args.includes('--write'),
    drinks20: args.includes('--drinks-20'),
  };
}

/** Canonical drinks + DE free-text labels used by pilot menus (e.g. Enes Kebap). */
function isDrinkCategory(category) {
  const key = String(category ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return key === 'drinks' || key === 'getranke' || key === 'getraenke';
}

function proposedVatRate(item, drinks20) {
  return drinks20 && isDrinkCategory(item.category) ? 20 : 10;
}

async function businessIdsFor(options, refs) {
  if (!options.all) {
    const businessSnap = await refs.businessRef(options.businessId).get();
    if (!businessSnap.exists) {
      throw new Error(`Business not found: ${options.businessId}`);
    }
    return [options.businessId];
  }

  const businessesSnap = await refs.businessesCollectionRef().get();
  return businessesSnap.docs.map((doc) => doc.id);
}

async function backfillBusiness(businessId, options, menuRef) {
  const menuSnap = await menuRef(businessId).get();
  let missing = 0;
  let written = 0;

  for (const doc of menuSnap.docs) {
    const item = doc.data();
    if (item.vatRate != null) continue;

    missing += 1;
    const vatRate = proposedVatRate(item, options.drinks20);
    const name = item.name ?? '(unnamed)';
    const category = item.category ?? '(missing)';
    const action = options.write ? 'WRITE' : 'DRY-RUN';
    console.log(
      `[${action}] ${businessId}/menu/${doc.id} "${name}" category=${category} -> vatRate=${vatRate}`,
    );

    if (options.write) {
      await doc.ref.update({ vatRate });
      written += 1;
    }
  }

  console.log(
    `[SUMMARY] ${businessId}: scanned=${menuSnap.size} missing=${missing} written=${written}`,
  );
  return { scanned: menuSnap.size, missing, written };
}

async function run(options, refs) {
  const businessIds = await businessIdsFor(options, refs);
  const totals = { businesses: businessIds.length, scanned: 0, missing: 0, written: 0 };

  for (const businessId of businessIds) {
    const result = await backfillBusiness(businessId, options, refs.menuRef);
    totals.scanned += result.scanned;
    totals.missing += result.missing;
    totals.written += result.written;
  }

  console.log(
    `\nDone: businesses=${totals.businesses} scanned=${totals.scanned} missing=${totals.missing} written=${totals.written}`,
  );
  if (!options.write) {
    console.log('Dry-run only. Re-run with --write to persist these changes.');
  }
  return totals;
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
  const { admin } = require('../src/lib/firebase');
  const {
    businessRef,
    businessesCollectionRef,
    menuRef,
  } = require('../src/lib/collections');

  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(
      `Menu VAT backfill (${options.write ? 'WRITE' : 'DRY-RUN'}${options.drinks20 ? ', drinks=20%' : ''})\n`,
    );
    await run(options, { businessRef, businessesCollectionRef, menuRef });
  } finally {
    await admin.app().delete();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  backfillBusiness,
  businessIdsFor,
  isDrinkCategory,
  parseArgs,
  proposedVatRate,
  run,
};
