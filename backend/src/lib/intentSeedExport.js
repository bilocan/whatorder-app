/**
 * Pure logic for the release-time intent-learning seed export.
 * CLI wrapper: src/scripts/exportIntentLearningsSeed.js
 * Runtime consumer: src/bot/intentSeed.js
 *
 * Decision doc: whatorder-vault/Intelligence/decisions/2026-07-14-intent-learnings-release-seed.md
 */

/** Long digit runs look like phone numbers / order ids — never bake those into git. */
const PRIVACY_DIGIT_RUN_RE = /\d{5,}/;

/**
 * Quality bar for baking a learning into the app image.
 * @param {object} row - intentLearnings doc data (plus id)
 * @param {{ minHits: number, menuIds: Set<string> }} ctx
 * @returns {{ eligible: boolean, reason?: string }}
 */
function eligibleSeedRow(row, { minHits, menuIds }) {
  const textKey = String(row?.textKey ?? '').trim();
  if (!textKey) return { eligible: false, reason: 'missing_textKey' };
  if (PRIVACY_DIGIT_RUN_RE.test(textKey)) return { eligible: false, reason: 'privacy_digit_run' };

  const hitCount = Number(row?.hitCount) || 0;
  if (hitCount < minHits) return { eligible: false, reason: 'below_min_hits' };

  const items = Array.isArray(row?.items) ? row.items : [];
  if (!items.length) return { eligible: false, reason: 'no_items' };
  if (!items.every(i => i && typeof (i.name ?? i.rawName) === 'string')) {
    return { eligible: false, reason: 'malformed_items' };
  }

  // Items that reference a menu doc must still resolve; name-only items replay
  // through menu repair at runtime and stay eligible.
  const stale = items.some(i => i?.menuItemId && !menuIds.has(String(i.menuItemId)));
  if (stale) return { eligible: false, reason: 'stale_menu_item' };

  return { eligible: true };
}

/** Seed entry shape consumed by src/bot/intentSeed.js (docId is the Firestore doc id). */
function seedEntryFromRow(docId, row) {
  return {
    docId,
    items: row.items,
    partySize: row.partySize ?? null,
    operation: row.operation === 'remove' ? 'remove' : 'add',
    source: row.source ?? null,
    hitCount: Number(row.hitCount) || 0,
  };
}

function sortedObject(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * @param {Record<string, Record<string, object>>} byBusiness businessId → textKey → entry
 * @returns seed file object with deterministically sorted keys (stable git diffs)
 */
function buildSeedFile(byBusiness, { release = null, generatedAt = new Date().toISOString() } = {}) {
  const businesses = {};
  for (const [businessId, entries] of Object.entries(byBusiness).sort(([a], [b]) => a.localeCompare(b))) {
    if (Object.keys(entries).length) businesses[businessId] = sortedObject(entries);
  }
  return { generatedAt, release, businesses };
}

module.exports = {
  PRIVACY_DIGIT_RUN_RE,
  eligibleSeedRow,
  seedEntryFromRow,
  buildSeedFile,
};
