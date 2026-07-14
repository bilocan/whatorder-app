/**
 * Release-time export: bake high-confidence intentLearnings into
 * src/data/intentLearnings.seed.json and move the exported docs to the
 * businesses/{id}/seededIntents archive (never hard-deleted).
 *
 * The seed is CUMULATIVE: previously seeded entries are carried forward from
 * the archive (re-validated against the current menu, minus overridden keys),
 * fresh eligible learnings win by textKey (corrections re-qualify here).
 *
 * Usage:
 *   node src/scripts/exportIntentLearningsSeed.js --release=v1.2.3            # dry-run: report only
 *   node src/scripts/exportIntentLearningsSeed.js --release=v1.2.3 --write    # write seed file + move docs
 *   node src/scripts/exportIntentLearningsSeed.js --restore=v1.2.3            # rollback: copy archive rows back
 *   node src/scripts/exportIntentLearningsSeed.js --disable-business=biz_x    # partial rollback: override all
 *                                                                             # seeded phrases of one business
 *   Options: --business=biz_x  --exclude=biz_a,biz_b  --min-hits=N
 *
 * Decision doc: whatorder-vault/Intelligence/decisions/2026-07-14-intent-learnings-release-seed.md
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const fs = require('fs');
const path = require('path');
const { admin, db } = require('../lib/firebase');
const {
  businessesCollectionRef, businessRef, menuRef, seededIntentRef, intentLearningRef, seedOverridesRef,
} = require('../lib/collections');
const { promoteHitThreshold } = require('../bot/intentLearningPromote');
const { seedReplayVeto } = require('../bot/intentSeedGuards');
const {
  eligibleSeedRow, seedEntryFromRow, buildSeedFile, diffSeeds,
} = require('../lib/intentSeedExport');

const SEED_PATH = path.resolve(__dirname, '../data/intentLearnings.seed.json');
const BATCH_ROWS = 200; // copy + delete = 2 ops/row, stay under the 500-op batch limit

function parseArgs(argv) {
  const flag = (name) => argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    write: argv.includes('--write'),
    restore: flag('restore') ?? null,
    disableBusiness: flag('disable-business') ?? null,
    release: flag('release') ?? null,
    business: flag('business') ?? null,
    exclude: (flag('exclude') ?? '').split(',').map(s => s.trim()).filter(Boolean),
    minHits: flag('min-hits') ? Number(flag('min-hits')) : promoteHitThreshold(),
  };
}

function readExistingSeed() {
  try {
    return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  } catch {
    return { generatedAt: null, release: null, businesses: {} };
  }
}

async function listBusinessIds({ business, exclude }) {
  if (business) return [business];
  const snap = await businessesCollectionRef().get();
  return snap.docs.map(d => d.id).filter(id => !exclude.includes(id));
}

async function loadOverrideKeys(businessId) {
  try {
    const snap = await seedOverridesRef(businessId).get();
    const list = snap.exists ? snap.data()?.textKeys : null;
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

async function exportBusiness(businessId, { minHits }) {
  const [menuSnap, learningsSnap, seededSnap, overriddenKeys] = await Promise.all([
    menuRef(businessId).get(),
    businessRef(businessId).collection('intentLearnings').get(),
    businessRef(businessId).collection('seededIntents').get(),
    loadOverrideKeys(businessId),
  ]);
  const menuIds = new Set(menuSnap.docs.map(d => d.id));

  const entries = {};
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };

  // Carry forward previously seeded learnings — the archive is the source of
  // truth between releases (live docs were moved out at the last export).
  // Overridden keys and entries that no longer resolve on the menu drop out.
  let carried = 0;
  for (const doc of seededSnap.docs) {
    const row = doc.data();
    if (!row.textKey) { skip('archive_missing_textKey'); continue; }
    if (overriddenKeys.has(row.textKey)) { skip('archive_overridden'); continue; }
    const check = eligibleSeedRow(row, { minHits, menuIds });
    if (!check.eligible) { skip(`archive_${check.reason}`); continue; }
    const veto = seedReplayVeto(row.textKey, row);
    if (veto) { skip(`archive_${veto.reason}`); continue; }
    entries[row.textKey] = seedEntryFromRow(doc.id, row);
    carried += 1;
  }

  // Fresh eligible learnings win by textKey (corrections re-qualify here).
  const moves = [];
  for (const doc of learningsSnap.docs) {
    const row = doc.data();
    const check = eligibleSeedRow(row, { minHits, menuIds });
    if (!check.eligible) { skip(check.reason); continue; }
    const veto = seedReplayVeto(row.textKey, row);
    if (veto) { skip(veto.reason); continue; }
    entries[row.textKey] = seedEntryFromRow(doc.id, row);
    moves.push({ docId: doc.id, row });
  }

  // Overrides for keys that ship (corrected) in the NEW seed are stale — prune
  // them so the corrected entry replays. Keys dropped from the seed keep their
  // override: still-running old images (and image rollbacks) bake the old seed,
  // and only the override protects against the retired entry resurfacing.
  const pruneOverrides = [...overriddenKeys].filter(k => entries[k]);

  return {
    entries, moves, skipped, carried, pruneOverrides, total: learningsSnap.size,
  };
}

async function moveToArchive(businessId, moves, release) {
  for (let i = 0; i < moves.length; i += BATCH_ROWS) {
    const batch = db.batch();
    for (const { docId, row } of moves.slice(i, i + BATCH_ROWS)) {
      batch.set(seededIntentRef(businessId, docId), {
        ...row,
        seededInRelease: release,
        movedAt: admin.firestore.FieldValue.serverTimestamp(),
        // A re-exported correction supersedes nothing anymore — clear the marker.
        supersededAt: admin.firestore.FieldValue.delete(),
      }, { merge: true });
      batch.delete(intentLearningRef(businessId, docId));
    }
    await batch.commit();
  }
}

async function pruneOverrideKeys(businessId, keys) {
  if (!keys.length) return;
  await seedOverridesRef(businessId).set({
    textKeys: admin.firestore.FieldValue.arrayRemove(...keys),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
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

/**
 * Partial rollback without a redeploy: override every archived phrase of one
 * business, so running instances stop replaying its seed within the TTL.
 */
async function disableBusinessSeed(businessId, { write }) {
  const snap = await businessRef(businessId).collection('seededIntents').get();
  const textKeys = [...new Set(snap.docs.map(d => d.data()?.textKey).filter(Boolean))];
  if (!textKeys.length) {
    console.log(`${businessId}: no archived seeded phrases — nothing to disable.`);
    return;
  }
  if (!write) {
    console.log(`${businessId}: would override ${textKeys.length} seeded phrase(s). Pass --write to apply.`);
    return;
  }
  await seedOverridesRef(businessId).set({
    textKeys: admin.firestore.FieldValue.arrayUnion(...textKeys),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`${businessId}: ${textKeys.length} seeded phrase(s) overridden — instances pick it up within ~10 min.`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.disableBusiness) {
    await disableBusinessSeed(opts.disableBusiness, opts);
    return;
  }

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

  const existingSeed = readExistingSeed();
  // A filtered run must not clobber other businesses' sections; a full run
  // rebuilds from scratch so offboarded businesses drop out.
  const filtered = Boolean(opts.business) || opts.exclude.length > 0;
  const byBusiness = filtered ? { ...(existingSeed.businesses ?? {}) } : {};

  const allMoves = {};
  const allPrunes = {};
  for (const businessId of businessIds) {
    const { entries, moves, skipped, carried, pruneOverrides, total } = await exportBusiness(businessId, opts);
    byBusiness[businessId] = entries;
    allMoves[businessId] = moves;
    allPrunes[businessId] = pruneOverrides;
    const skippedDesc = Object.entries(skipped).map(([r, n]) => `${r}=${n}`).join(' ') || 'none';
    console.log(`${businessId}: ${total} live learnings → ${moves.length} exported, ${carried} carried from archive, skipped: ${skippedDesc}`);
  }

  const seed = buildSeedFile(byBusiness, { release: opts.release });
  const exportedCount = Object.values(seed.businesses).reduce((n, e) => n + Object.keys(e).length, 0);

  const diff = diffSeeds(existingSeed, seed);
  console.log(`\nSeed diff vs ${existingSeed.release ?? 'previous file'}: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed`);
  for (const key of diff.added) console.log(`  + ${key}`);
  for (const key of diff.removed) console.log(`  - ${key}`);
  for (const key of diff.changed) console.log(`  ~ ${key}`);

  if (!opts.write) {
    console.log(`\nDry run — would write ${exportedCount} entr(ies) to ${SEED_PATH}`);
    console.log('Pass --write to write the seed file, move exported docs to seededIntents, and prune stale overrides');
    return;
  }

  fs.writeFileSync(SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`\nWrote ${exportedCount} entr(ies) to ${SEED_PATH}`);

  for (const businessId of businessIds) {
    if (allMoves[businessId].length) {
      await moveToArchive(businessId, allMoves[businessId], opts.release);
      console.log(`  ${businessId}: moved ${allMoves[businessId].length} doc(s) to seededIntents`);
    }
    if (allPrunes[businessId].length) {
      await pruneOverrideKeys(businessId, allPrunes[businessId]);
      console.log(`  ${businessId}: pruned ${allPrunes[businessId].length} re-exported override(s)`);
    }
  }
  console.log(`\nDone. Commit the seed file in the release PR; verify: npm run intent:seed-verify; rollback: --restore=${opts.release}`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
