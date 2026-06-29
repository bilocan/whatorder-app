const { admin } = require('../lib/firebase');
const { intentLearningRef, menuRef } = require('../lib/collections');
const { norm, tokensOf } = require('./menuMapper');
const { MAX_ITEM_ALIASES } = require('./menuItemAliases');

const DEFAULT_PROMOTE_HIT_THRESHOLD = 3;

/**
 * Min confirmed proposals before copying a phrase to menu item aliases[].
 * Override: INTENT_ALIAS_PROMOTE_MIN_HITS=1 in backend env (see backend-env.md).
 */
function promoteHitThreshold() {
  const raw = process.env.INTENT_ALIAS_PROMOTE_MIN_HITS;
  if (raw === undefined || raw === '') return DEFAULT_PROMOTE_HIT_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PROMOTE_HIT_THRESHOLD;
  return Math.floor(n);
}

const LEADING_QTY_RE = /^\d+\s+/;
const MIN_ALIAS_LEN = 3;
const MAX_ALIAS_LEN = 64;

function stripLeadingQty(textKey) {
  return String(textKey ?? '').replace(LEADING_QTY_RE, '').trim();
}

/**
 * Derive per-SKU alias candidates from a validated learning row.
 * @returns {{ menuItemId: string, itemName: string, aliases: string[] }[]}
 */
function aliasCandidatesFromLearning(textKey, items) {
  const rows = (items ?? []).filter(i => i?.menuItemId && (i.name || i.rawName));
  if (!rows.length) return [];

  if (rows.length === 1) {
    const item = rows[0];
    const aliases = new Set();
    const phrase = stripLeadingQty(textKey);
    if (phrase) aliases.add(phrase);
    const raw = item.rawName?.trim();
    if (raw && norm(raw) !== norm(phrase)) aliases.add(raw);
    return [{
      menuItemId: item.menuItemId,
      itemName: item.name,
      aliases: [...aliases],
    }];
  }

  return rows
    .filter(i => i.rawName?.trim())
    .map(i => ({
      menuItemId: i.menuItemId,
      itemName: i.name,
      aliases: [i.rawName.trim()],
    }));
}

function isWorthPromoting(alias, itemName, existingAliases = []) {
  const a = norm(alias);
  if (!a || a.length < MIN_ALIAS_LEN || a.length > MAX_ALIAS_LEN) return false;

  const canon = new Set(
    [itemName, ...(existingAliases ?? [])]
      .filter(Boolean)
      .map(s => norm(s)),
  );
  if (canon.has(a)) return false;

  const nameTokens = tokensOf(itemName);
  if (nameTokens.includes(a)) return false;

  // Single-token alias already covered by global synonym groups — skip noise.
  if (!a.includes(' ') && nameTokens.some(t => t.startsWith(a) || a.startsWith(t))) {
    return false;
  }

  return true;
}

function filterPromotableAliases(candidates, itemName, existingAliases) {
  const out = [];
  const seen = new Set([norm(itemName), ...(existingAliases ?? []).map(norm)]);
  for (const alias of candidates) {
    const trimmed = String(alias ?? '').trim();
    if (!trimmed || !isWorthPromoting(trimmed, itemName, existingAliases)) continue;
    const key = norm(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * After hitCount crosses threshold, persist useful phrases on menu item aliases[].
 * Fire-and-forget; never blocks the customer path.
 */
async function maybePromoteLearnedAliases(businessId, docId, textKey, items) {
  if (!businessId || !docId || !textKey?.trim()) return { promoted: false };

  const learningRef = intentLearningRef(businessId, docId);
  const snap = await learningRef.get();
  if (!snap.exists) return { promoted: false };

  const data = snap.data();
  if (data?.aliasesPromotedAt) return { promoted: false, reason: 'already_promoted' };

  const hitCount = Number(data?.hitCount) || 0;
  if (hitCount < promoteHitThreshold()) {
    return { promoted: false, reason: 'below_threshold', hitCount };
  }

  const groups = aliasCandidatesFromLearning(textKey, items);
  if (!groups.length) return { promoted: false, reason: 'no_candidates' };

  const promotedAliases = [];
  const batch = admin.firestore().batch();
  let writes = 0;

  for (const group of groups) {
    const menuDocRef = menuRef(businessId).doc(group.menuItemId);
    const menuSnap = await menuDocRef.get();
    if (!menuSnap.exists) continue;

    const menuData = menuSnap.data();
    const itemName = menuData?.name ?? group.itemName ?? '';
    const existing = menuData?.aliases ?? [];
    const toAdd = filterPromotableAliases(group.aliases, itemName, existing);
    if (!toAdd.length) continue;

    const merged = [...existing, ...toAdd]
      .filter((a, i, arr) => arr.findIndex(x => norm(x) === norm(a)) === i)
      .slice(0, MAX_ITEM_ALIASES);

    batch.update(menuDocRef, {
      aliases: merged,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    writes += 1;
    promotedAliases.push(...toAdd.map(a => ({ menuItemId: group.menuItemId, alias: a })));
  }

  if (!writes) return { promoted: false, reason: 'no_useful_aliases' };

  batch.update(learningRef, {
    aliasesPromotedAt: admin.firestore.FieldValue.serverTimestamp(),
    promotedAliases: promotedAliases.map(p => p.alias),
  });
  await batch.commit();

  if (process.env.NODE_ENV !== 'test') {
    console.info(
      `[intent-learning] promoted ${promotedAliases.length} alias(es) for ${businessId} (${textKey.slice(0, 40)})`,
    );
  }

  return { promoted: true, promotedAliases };
}

function scheduleAliasPromotion(businessId, docId, textKey, items) {
  void maybePromoteLearnedAliases(businessId, docId, textKey, items).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] alias promote failed: ${err.message}`);
    }
  });
}

module.exports = {
  DEFAULT_PROMOTE_HIT_THRESHOLD,
  promoteHitThreshold,
  stripLeadingQty,
  aliasCandidatesFromLearning,
  isWorthPromoting,
  filterPromotableAliases,
  maybePromoteLearnedAliases,
  scheduleAliasPromotion,
};
