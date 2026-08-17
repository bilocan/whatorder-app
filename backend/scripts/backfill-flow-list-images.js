/**
 * Backfill durable WhatsApp Flow list thumbs (`flowListImage`) on menu items.
 *
 * Targets the Firebase project in backend/.env.local. Uses allowlisted
 * Storage hosts only (same SSRF guards as flowImages.js). External catalog
 * image_link hosts are skipped → those items stay on color tiles unless
 * photos are copied into Firebase Storage first.
 *
 * Usage (dry-run by default):
 *   node scripts/backfill-flow-list-images.js --business <businessId>
 *   node scripts/backfill-flow-list-images.js --business <businessId> --write
 *   node scripts/backfill-flow-list-images.js --business <businessId> --write --force
 *
 * Record runs in vault: Projects/WhatOrder/notes/ops-firestore-data-migrations.md
 */

const USAGE =
  'Usage: node scripts/backfill-flow-list-images.js --business <businessId> [--write] [--force]';

function parseArgs(args) {
  const allowedFlags = new Set(['--business', '--write', '--force']);
  const unknownFlags = args.filter((arg) => arg.startsWith('--') && !allowedFlags.has(arg));
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown option: ${unknownFlags[0]}\n${USAGE}`);
  }

  const bizIdx = args.indexOf('--business');
  if (bizIdx === -1 || !args[bizIdx + 1] || args[bizIdx + 1].startsWith('--')) {
    throw new Error(USAGE);
  }

  return {
    businessId: args[bizIdx + 1],
    write: args.includes('--write'),
    force: args.includes('--force'),
  };
}

async function backfillBusiness(businessId, options, deps) {
  const { menuRef, resolvePhotoUrl, flowListImageFromUrl, normalizeStoredFlowListImage } = deps;
  const businessSnap = await deps.businessRef(businessId).get();
  if (!businessSnap.exists) {
    throw new Error(`Business not found: ${businessId}`);
  }

  const menuSnap = await menuRef(businessId).get();
  let scanned = 0;
  let skipped = 0;
  let wouldWrite = 0;
  let written = 0;
  let failed = 0;

  for (const doc of menuSnap.docs) {
    scanned += 1;
    const item = doc.data();
    const name = item.name ?? '(unnamed)';
    const existing = normalizeStoredFlowListImage(item.flowListImage);
    if (existing && !options.force) {
      skipped += 1;
      continue;
    }

    const resolved = resolvePhotoUrl(item.photoUrl);
    if (!resolved) {
      skipped += 1;
      console.log(`[SKIP] ${businessId}/menu/${doc.id} "${name}" (no allowlisted photoUrl)`);
      continue;
    }

    const thumb = await flowListImageFromUrl(resolved);
    if (!thumb) {
      failed += 1;
      console.log(`[FAIL] ${businessId}/menu/${doc.id} "${name}" (fetch/resize failed)`);
      continue;
    }

    wouldWrite += 1;
    const action = options.write ? 'WRITE' : 'DRY-RUN';
    console.log(`[${action}] ${businessId}/menu/${doc.id} "${name}" flowListImage=${thumb.length} chars`);

    if (options.write) {
      await doc.ref.update({ flowListImage: thumb });
      written += 1;
    }
  }

  console.log(
    `[SUMMARY] ${businessId}: scanned=${scanned} skipped=${skipped} wouldWrite=${wouldWrite} written=${written} failed=${failed}`,
  );
  return { scanned, skipped, wouldWrite, written, failed };
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
  const { admin } = require('../src/lib/firebase');
  const { businessRef, menuRef } = require('../src/lib/collections');
  const { resolvePhotoUrl } = require('../src/bot/menuService');
  const {
    flowListImageFromUrl,
    normalizeStoredFlowListImage,
    isAllowedPhotoFetchUrl,
  } = require('../src/lib/flowImages');

  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(
      `Flow list-image backfill (${options.write ? 'WRITE' : 'DRY-RUN'}${options.force ? ', force' : ''}) business=${options.businessId}\n`,
    );
    await backfillBusiness(options.businessId, options, {
      businessRef,
      menuRef,
      resolvePhotoUrl: (url) => {
        const resolved = resolvePhotoUrl(url);
        if (!resolved || !isAllowedPhotoFetchUrl(resolved)) return null;
        return resolved;
      },
      flowListImageFromUrl,
      normalizeStoredFlowListImage,
    });
    if (!options.write) {
      console.log('\nDry-run only. Re-run with --write to persist these changes.');
    }
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
  parseArgs,
  backfillBusiness,
};
