/**
 * Runtime replay guards shared by the seed export and the release verifier.
 *
 * Mirrors the parser's learned-gate: a seed entry these veto would never
 * replay at runtime (rules answer instead), so the export must not bake it
 * and the verifier must fail it. Keep in sync with the learned-hit path in
 * intentParser.js.
 *
 * Decision doc: whatorder-vault/Intelligence/decisions/2026-07-14-intent-learnings-release-seed.md
 */

const { parseIntent } = require('./intentParser');
const { detectRemovePhrase } = require('./intentRemoveDetect');
const { shouldRejectStaleLearnedHit } = require('./intentPartialMatch');

/**
 * @param {string} textKey canonical learned key
 * @param {{ items?: object[], operation?: string }} entry learning row or seed entry
 * @returns {{ reason: string, detail: string } | null} veto, or null when the entry replays
 */
function seedReplayVeto(textKey, entry) {
  const operation = entry?.operation === 'remove' ? 'remove' : 'add';

  if (operation === 'add' && detectRemovePhrase(textKey)) {
    return { reason: 'structural_remove_skip', detail: 'add-learning on remove-shaped phrase' };
  }

  if (shouldRejectStaleLearnedHit(textKey, entry, parseIntent(textKey))) {
    return { reason: 'stale_hit_reject', detail: 'rules parse now outmatches the learning' };
  }

  return null;
}

module.exports = { seedReplayVeto };
