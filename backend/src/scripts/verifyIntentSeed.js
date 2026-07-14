/**
 * Release gate: verify every entry in src/data/intentLearnings.seed.json
 * would actually replay at runtime. Read-only — no Firestore writes.
 *
 * Mirrors the parser's learned-gate guards:
 *   1. reachability — lookupLearnedIntent(textKey) resolves to the seed entry
 *      (catches intentNormalize drift since export, and hydration drops)
 *   2. menu drift  — every menuItemId still resolves on the live menu
 *   3. stale-hit   — shouldRejectStaleLearnedHit would not veto the replay
 *   4. structural  — an add-learning on a remove-shaped phrase never replays
 * Overridden textKeys (config/seedOverrides) are reported as skipped, not failed.
 *
 * Usage:
 *   npm run intent:seed-verify            # exit 1 on any failure
 *   npm run intent:seed-verify -- --json
 *
 * Decision doc: whatorder-vault/Intelligence/decisions/2026-07-14-intent-learnings-release-seed.md
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const { menuRef, seedOverridesRef } = require('../lib/collections');
const { seedEnabled } = require('../bot/intentSeed');
const { lookupLearnedIntent, normalizeOperation } = require('../bot/intentLearning');
const { parseIntent } = require('../bot/intentParser');
const { detectRemovePhrase } = require('../bot/intentRemoveDetect');
const { shouldRejectStaleLearnedHit } = require('../bot/intentPartialMatch');

// eslint-disable-next-line import/no-unresolved
const seed = require('../data/intentLearnings.seed.json');

async function loadOverrideKeys(businessId) {
  try {
    const snap = await seedOverridesRef(businessId).get();
    const list = snap.exists ? snap.data()?.textKeys : null;
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

async function verifyBusiness(businessId, entries) {
  const [menuSnap, overridden] = await Promise.all([
    menuRef(businessId).get(),
    loadOverrideKeys(businessId),
  ]);
  const menuIds = new Set(menuSnap.docs.map(d => d.id));

  const failures = [];
  let skipped = 0;
  let passed = 0;

  for (const [textKey, entry] of Object.entries(entries)) {
    if (overridden.has(textKey)) {
      skipped += 1;
      continue;
    }

    const stale = (entry.items ?? []).filter(i => i?.menuItemId && !menuIds.has(String(i.menuItemId)));
    if (stale.length) {
      failures.push({ textKey, reason: 'stale_menu_item', detail: stale.map(i => i.menuItemId).join(', ') });
      continue;
    }

    const learned = await lookupLearnedIntent(businessId, textKey);
    if (!learned || learned.origin !== 'seed') {
      failures.push({
        textKey,
        reason: 'not_replayed',
        detail: learned ? `resolved from ${learned.origin ?? 'firestore'}` : 'lookup returned null (normalization drift?)',
      });
      continue;
    }

    const structural = detectRemovePhrase(textKey);
    if (structural && normalizeOperation(learned.operation) === 'add') {
      failures.push({ textKey, reason: 'structural_remove_skip', detail: 'add-learning on remove-shaped phrase' });
      continue;
    }

    if (shouldRejectStaleLearnedHit(textKey, learned, parseIntent(textKey))) {
      failures.push({ textKey, reason: 'stale_hit_reject', detail: 'rules parse now outmatches the learning' });
      continue;
    }

    passed += 1;
  }

  return { businessId, total: Object.keys(entries).length, passed, skipped, failures };
}

async function main() {
  const json = process.argv.includes('--json');

  if (!seedEnabled()) {
    console.warn('INTENT_SEED_DISABLED=1 is set — unset it for verification, results would not reflect runtime.');
    process.exit(1);
  }

  const businesses = seed?.businesses ?? {};
  const businessIds = Object.keys(businesses);
  if (!businessIds.length) {
    console.log(`Seed is empty (release: ${seed?.release ?? 'none'}) — nothing to verify.`);
    return;
  }

  const results = [];
  for (const businessId of businessIds) {
    results.push(await verifyBusiness(businessId, businesses[businessId]));
  }

  const failed = results.reduce((n, r) => n + r.failures.length, 0);

  if (json) {
    console.log(JSON.stringify({ release: seed.release, generatedAt: seed.generatedAt, results, failed }, null, 2));
  } else {
    console.log(`Seed: release ${seed.release ?? '(none)'}, generated ${seed.generatedAt ?? '(unknown)'}\n`);
    for (const r of results) {
      console.log(`${r.businessId}: ${r.passed}/${r.total} replay ok${r.skipped ? `, ${r.skipped} overridden (skipped)` : ''}`);
      for (const f of r.failures) {
        console.log(`  FAIL ${f.reason}: "${f.textKey}" — ${f.detail}`);
      }
    }
    console.log(failed
      ? `\n${failed} entr(ies) would NOT replay — re-run the export or fix the learnings before release.`
      : '\nAll seeded entries replay at runtime.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
