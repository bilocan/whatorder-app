/**
 * Release-time export: bake high-confidence intentLearnings into
 * src/data/intentLearnings.seed.json and move the exported docs to the
 * businesses/{id}/seededIntents archive (never hard-deleted).
 *
 * Usage:
 *   node src/scripts/exportIntentLearningsSeed.js --release=v1.2.3            # dry-run: report only
 *   node src/scripts/exportIntentLearningsSeed.js --release=v1.2.3 --write    # write seed file + move docs
 *   node src/scripts/exportIntentLearningsSeed.js --restore=v1.2.3            # rollback: copy archive rows back
 *   Options: --business=biz_x  --exclude=biz_a,biz_b  --min-hits=N
 *
 * Decision doc: whatorder-vault/Intelligence/decisions/2026-07-14-intent-learnings-release-seed.md
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const fs = require('fs');
const path = require('path');
const { admin, db } = require('../lib/firebase');
const {
  businessesCollectionRef, businessRef, menuRef, seededIntentRef, intentLearningRef,
} = require('../lib/collections');
const { promoteHitThreshold } = require('../bot/intentLearningPromote');
const { eligibleSeedRow, seedEntryFromRow, buildSeedFile } = require('../lib/intentSeedExport');

const SEED_PATH = path.resolve(__dirname, '../data/intentLearnings.seed.json');
const BATCH_ROWS = 200; // copy + delete = 2 ops/row, stay under the 500-op batch limit

function parseArgs(argv) {
  const flag = (name) => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    write: argv.includes('--write'),
    restore: flag('restore') ?? null,
    release: flag('release') ?? null,
    business: flag('business') ?? null,
    exclude: (flag('exclude') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    minHits: flag('min-hits') ? Number(flag('min-hits')) : promoteHitThreshold(),
  };
}

async function listBusinessIds({ business, exclude }) {
  if (business) return [business];
  const snap = await businessesCollectionRef().get();
  return snap.docs.map(d => d.id).filter(id => !exclude.includes(id));
}

async function exportBusiness(businessId, { minHits }) {
  const [menuSnap, learningsSnap] = await Promise.all([
    menuRef(businessId).get(),
    businessRef(businessId).collection('intentLearnings').get(),
  ]);
  const menuIds = new Set(menuSnap.docs.map(d => d.id));

  const entries = {};
  const moves = [];
  const skipped = {};
  for (const doc of learningsSnap.docs) {
    const row = doc.data();
    const check = eligibleSeedRow(row, { minHits, menuIds });
    if (!check.eligible) {
      skipped[check.reason] = (skipped[check.reason] || 0) + 1;
      continue;
    }
    entries[row.textKey] = seedEntryFromRow(doc.id, row);
    moves.push({ docId: doc.id, row });
  }
  return { entries, moves, skipped, total: learningsSnap.size };
}

async function moveToArchive(businessId, moves, release) {
  for (let i = 0; i < moves.length; i += BATCH_ROWS) {
    const batch = db.batch();
    for (const { docId, row } of moves.slice(i, i + BATCH_ROWS)) {
      batch.set(seededIntentRef(businessId, docId), {
        ...row,
        seededInRelease: release,
        movedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.delete(intentLearningRef(businessId, docId));
    }
    await batch.commit();
  }
}

async function restoreRelease(businessId, release) {
  const snap = await businessRef(businessId).collection('seededIntents')
    .where('seededInRelease', '==', release).get();
  if (snap.empty) return 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_ROWS) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + BATCH_ROWS)) {
      const { seededInRelease, movedAt, ...row } = doc.data();
      batch.set(intentLearningRef(businessId, doc.id), row, { merge: true });
      batch.set(doc.ref, {
        restoredAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await batch.commit();
  }
  return snap.size;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const businessIds = await listBusinessIds(opts);

  if (opts.restore) {
    let restored = 0;
    for (const businessId of businessIds) {
      const n = await restoreRelease(businessId, opts.restore);
      if (n) console.log(`  ${businessId}: restored ${n} learning(s) from ${opts.restore}`);
      restored += n;
    }
    console.log(`\nRestored ${restored} learning(s) to intentLearnings (archive copies kept, marked restoredAt)`);
    return;
  }

  if (opts.write && !opts.release) {
    console.error('--write requires --release=vX.Y.Z (stamped on archived docs and the seed file)');
    process.exit(1);
  }

  const byBusiness = {};
  const allMoves = {};
  for (const businessId of businessIds) {
    const { entries, moves, skipped, total } = await exportBusiness(businessId, opts);
    byBusiness[businessId] = entries;
    allMoves[businessId] = moves;
    const skippedDesc = Object.entries(skipped).map(([r, n]) => `${r}=${n}`).join(' ') || 'none';
    console.log(`${businessId}: ${total} learnings, ${moves.length} exported, skipped: ${skippedDesc}`);
  }

  const seed = buildSeedFile(byBusiness, { release: opts.release });
  const exportedCount = Object.values(byBusiness).reduce((n, e) => n + Object.keys(e).length, 0);

  if (!opts.write) {
    console.log(`\nDry run — would write ${exportedCount} entr(ies) to ${SEED_PATH}`);
    console.log('Pass --write to write the seed file and move exported docs to seededIntents');
    return;
  }

  fs.writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`\nWrote ${exportedCount} entr(ies) to ${SEED_PATH}`);

  for (const businessId of businessIds) {
    if (allMoves[businessId].length) {
      await moveToArchive(businessId, allMoves[businessId], opts.release);
      console.log(`  ${businessId}: moved ${allMoves[businessId].length} doc(s) to seededIntents`);
    }
  }
  console.log('\nDone. Commit the seed file in the release PR; rollback: --restore=' + opts.release);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
