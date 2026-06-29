/**
 * Backfill menu item aliases from high-hit intentLearnings.
 *
 * Usage:
 *   node src/scripts/promoteIntentLearnings.js <businessId> [--dry-run] [--write] [--min-hits 3]
 *
 * Example:
 *   node src/scripts/promoteIntentLearnings.js biz_enes_kebap_9450w --write
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const { intentLearningRef } = require('../lib/collections');
const {
  DEFAULT_PROMOTE_HIT_THRESHOLD,
  promoteHitThreshold,
  maybePromoteLearnedAliases,
} = require('../bot/intentLearningPromote');

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const write = process.argv.includes('--write');
  const minHitsArg = process.argv.find(a => a.startsWith('--min-hits='));
  const minHits = minHitsArg ? Number(minHitsArg.split('=')[1]) : promoteHitThreshold();
  const [businessId] = args;

  if (!businessId) {
    console.error('Usage: node promoteIntentLearnings.js <businessId> [--dry-run] [--write] [--min-hits=N]');
    console.error(`  Default min hits: ${promoteHitThreshold()} (env INTENT_ALIAS_PROMOTE_MIN_HITS, else ${DEFAULT_PROMOTE_HIT_THRESHOLD})`);
    process.exit(1);
  }

  const snap = await intentLearningRef(businessId, '_').parent.get();
  const eligible = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(row => !row.aliasesPromotedAt && (Number(row.hitCount) || 0) >= minHits);

  console.log(`Business: ${businessId}`);
  console.log(`intentLearnings: ${snap.size} total, ${eligible.length} eligible (hitCount >= ${minHits})`);

  let promoted = 0;
  for (const row of eligible) {
    if (dryRun || !write) {
      console.log(`  would promote: ${row.textKey} (hits=${row.hitCount})`);
      continue;
    }
    const result = await maybePromoteLearnedAliases(
      businessId,
      row.id,
      row.textKey,
      row.items ?? [],
    );
    if (result.promoted) {
      promoted += 1;
      console.log(`  promoted: ${row.textKey} → ${result.promotedAliases.map(p => p.alias).join(', ')}`);
    }
  }

  if (dryRun || !write) {
    console.log(write ? '' : '\nDry run — pass --write to persist aliases on menu items');
    process.exit(0);
  }

  console.log(`\nPromoted aliases from ${promoted} learning(s)`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
