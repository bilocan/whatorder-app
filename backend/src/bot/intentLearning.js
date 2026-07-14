const crypto = require('crypto');
const { admin } = require('../lib/firebase');
const { intentLearningRef, seededIntentRef, seedOverridesRef } = require('../lib/collections');
const { intentLearnKey, intentLearnKeyVariants } = require('./intentNormalize');
const { levenshtein, maxTypoDistance } = require('./menuSynonyms');
const { scheduleAliasPromotion } = require('./intentLearningPromote');
const { learnedItemIdsChanged } = require('./intentLearningRebind');
const { isPartialBlobTrap, countDistinctProductStems } = require('./intentPartialMatch');
const { seedEnabled, seedEntriesForBusiness, seedEntryForKey } = require('./intentSeed');

/** In-process L1: businessId → Map(textKey → intent payload). */
const memoryByBusiness = new Map();
/** businessId → whether all Firestore keys were loaded for fuzzy scan. */
const fuzzyIndexLoaded = new Set();
/** Businesses whose baked seed entries were copied into memory. */
const seedHydrated = new Set();
/** businessId → { keys: Set<textKey>, loadedAt } — corrections that shadow the seed. */
const seedOverridesCache = new Map();
const SEED_OVERRIDES_TTL_MS = 10 * 60 * 1000;

const FUZZY_KEY_MAX_DIST = 3;
const FUZZY_MIN_KEY_LEN = 8;
const LEARNED_OPERATIONS = new Set(['add', 'remove']);

function normalizeOperation(operation) {
  const op = String(operation ?? 'add').toLowerCase();
  return LEARNED_OPERATIONS.has(op) ? op : 'add';
}

function shouldPromoteAliases(operation) {
  return normalizeOperation(operation) === 'add';
}

function memoryGet(businessId, textKey) {
  return memoryByBusiness.get(businessId)?.get(textKey) ?? null;
}

function memorySet(businessId, textKey, payload) {
  if (!memoryByBusiness.has(businessId)) {
    memoryByBusiness.set(businessId, new Map());
  }
  memoryByBusiness.get(businessId).set(textKey, payload);
}

function memoryKeys(businessId) {
  return [...(memoryByBusiness.get(businessId)?.keys() ?? [])];
}

function docIdForKey(textKey) {
  return crypto.createHash('sha256').update(textKey).digest('hex').slice(0, 40);
}

function extractDigitTokens(key) {
  const matches = String(key ?? '').match(/\d+/g);
  return matches ? matches.map(n => parseInt(n, 10)) : [];
}

/** Qty digits in learn keys are semantic — never fuzzy-match across different counts. */
function keysDigitTokensCompatible(a, b) {
  const digitsA = extractDigitTokens(a);
  const digitsB = extractDigitTokens(b);
  if (digitsA.length !== digitsB.length) return false;
  return digitsA.every((d, i) => d === digitsB[i]);
}

function keysAreFuzzyMatch(a, b) {
  if (!a || !b || a === b) return a === b;
  if (!keysDigitTokensCompatible(a, b)) return false;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < FUZZY_MIN_KEY_LEN) return false;
  const maxDist = Math.min(FUZZY_KEY_MAX_DIST, maxTypoDistance(a, b) + 1);
  return levenshtein(a, b) <= maxDist;
}

function findFuzzyMemoryHit(businessId, textKey) {
  for (const cachedKey of memoryKeys(businessId)) {
    if (keysAreFuzzyMatch(textKey, cachedKey)) {
      return memoryGet(businessId, cachedKey);
    }
  }
  return null;
}

async function loadFuzzyIndexFromFirestore(businessId) {
  if (fuzzyIndexLoaded.has(businessId)) return;
  fuzzyIndexLoaded.add(businessId);
  try {
    const snap = await intentLearningRef(businessId, '_').parent.get();
    for (const doc of snap.docs) {
      const data = doc.data();
      const key = data?.textKey;
      const items = sanitizeItems(data?.items);
      if (!key || !items.length) continue;
      if (!memoryGet(businessId, key)) {
        memorySet(businessId, key, {
          items: sanitizeItems(data?.items),
          partySize: data.partySize ?? null,
          operation: normalizeOperation(data.operation),
        });
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] fuzzy index load failed: ${err.message}`);
    }
  }
}

/**
 * Load the per-business seedOverrides doc (corrections/deletions that must
 * shadow the baked seed). One read per business, cached with a TTL.
 * @returns {Promise<{ keys: Set<string>, refreshed: boolean }>}
 */
async function loadSeedOverrides(businessId) {
  const cached = seedOverridesCache.get(businessId);
  if (cached && Date.now() - cached.loadedAt < SEED_OVERRIDES_TTL_MS) {
    return { keys: cached.keys, refreshed: false };
  }
  let keys = cached?.keys ?? new Set();
  try {
    const snap = await seedOverridesRef(businessId).get();
    const list = snap.exists ? snap.data()?.textKeys : null;
    keys = new Set(Array.isArray(list) ? list.map(String) : []);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-seed] overrides load failed: ${err.message}`);
    }
  }
  seedOverridesCache.set(businessId, { keys, loadedAt: Date.now() });
  return { keys, refreshed: true };
}

/**
 * L0: copy baked seed entries into the in-process memory cache, skipping
 * overridden keys. Re-syncs whenever the overrides doc is (re)fetched, so a
 * correction made on another instance takes effect within the TTL.
 */
async function ensureSeedHydrated(businessId) {
  if (!businessId || !seedEnabled()) return;
  const entries = seedEntriesForBusiness(businessId);
  const textKeys = Object.keys(entries);
  if (!textKeys.length) return;

  const { keys: overridden, refreshed } = await loadSeedOverrides(businessId);
  if (seedHydrated.has(businessId) && !refreshed) return;

  for (const textKey of textKeys) {
    if (overridden.has(textKey)) continue;
    if (memoryGet(businessId, textKey)) continue;
    const entry = entries[textKey];
    const items = sanitizeItems(entry?.items);
    if (!items.length) continue;
    memorySet(businessId, textKey, {
      items,
      partySize: entry.partySize ?? null,
      operation: normalizeOperation(entry.operation),
      origin: 'seed',
      docId: entry.docId ?? docIdForKey(textKey),
    });
  }

  // Evict seeded entries that got overridden since hydration.
  for (const textKey of overridden) {
    if (memoryGet(businessId, textKey)?.origin === 'seed') {
      memoryByBusiness.get(businessId)?.delete(textKey);
    }
  }
  seedHydrated.add(businessId);
}

/** Record a correction/deletion of a seeded phrase so the baked entry stops replaying. */
async function addSeedOverride(businessId, textKey, seedDocId) {
  await seedOverridesRef(businessId).set({
    textKeys: admin.firestore.FieldValue.arrayUnion(textKey),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  if (seedDocId) {
    await seededIntentRef(businessId, seedDocId).set({
      supersededAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  const cached = seedOverridesCache.get(businessId);
  if (cached) cached.keys.add(textKey);
  if (memoryGet(businessId, textKey)?.origin === 'seed') {
    memoryByBusiness.get(businessId)?.delete(textKey);
  }
}

function sanitizeItems(items) {
  return (items ?? [])
    .filter(i => i && typeof (i.name ?? i.rawName) === 'string')
    .map(i => {
      const out = {
        name: String(i.name ?? i.rawName).trim(),
        qty: Math.min(99, Math.max(1, Number(i.qty) || 1)),
      };
      if (i.menuItemId) out.menuItemId = String(i.menuItemId);
      if (i.modifierKey) out.modifierKey = String(i.modifierKey);
      if (i.rawName) out.rawName = String(i.rawName).trim();
      if (i.removeAll) out.removeAll = true;
      if (i.selections && typeof i.selections === 'object') {
        const selections = {};
        for (const [groupId, ids] of Object.entries(i.selections)) {
          if (!groupId) continue;
          const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
          if (list.length) selections[groupId] = list;
        }
        if (Object.keys(selections).length) out.selections = selections;
      }
      if (i.modifierKey) out.modifierKey = String(i.modifierKey);
      return out;
    })
    .filter(i => i.name);
}

function itemsFromMatched(matched, intentItems) {
  if (matched?.length) {
    return matched.map(line => {
      const out = {
        name: line.name,
        qty: Math.min(99, Math.max(1, Number(line.qty) || 1)),
      };
      if (line.menuItemId) out.menuItemId = line.menuItemId;
      if (line.modifierKey) out.modifierKey = line.modifierKey;
      if (line.rawIntentName) out.rawName = line.rawIntentName;
      return out;
    });
  }
  return sanitizeItems(intentItems);
}

async function loadExactKey(businessId, textKey) {
  const cached = memoryGet(businessId, textKey);
  if (cached) return cached;

  try {
    const snap = await intentLearningRef(businessId, docIdForKey(textKey)).get();
    if (!snap.exists) return null;

    const data = snap.data();
    const items = sanitizeItems(data?.items);
    if (!items.length) return null;

    const payload = {
      items: sanitizeItems(data?.items),
      partySize: data.partySize ?? null,
      operation: normalizeOperation(data.operation),
    };
    memorySet(businessId, textKey, payload);
    return payload;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] lookup failed: ${err.message}`);
    }
    return null;
  }
}

async function loadLearnedDoc(businessId, textKey) {
  if (!businessId || !textKey) return null;
  const docId = docIdForKey(textKey);
  try {
    const snap = await intentLearningRef(businessId, docId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    const items = sanitizeItems(data?.items);
    if (!items.length) return null;
    return {
      docId,
      textKey: String(data.textKey ?? textKey),
      data,
      items,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] doc load failed: ${err.message}`);
    }
    return null;
  }
}

/**
 * A learning row may live in intentLearnings (live) or seededIntents
 * (archived at release). Live wins — a correction shadows the seed.
 */
async function loadLearnedOrSeededDoc(businessId, textKey) {
  const live = await loadLearnedDoc(businessId, textKey);
  if (live) return live;

  const entry = seedEntryForKey(businessId, textKey);
  if (!entry?.docId) return null;
  try {
    const snap = await seededIntentRef(businessId, entry.docId).get();
    if (!snap.exists) return null;
    const data = snap.data();
    const items = sanitizeItems(data?.items);
    if (!items.length) return null;
    return {
      docId: entry.docId,
      textKey: String(data.textKey ?? textKey),
      data,
      items,
      seeded: true,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] seeded doc load failed: ${err.message}`);
    }
    return null;
  }
}

function toLearnedMeta({ docId, textKey, data, items, seeded }) {
  return {
    id: docId,
    textKey,
    hitCount: Number(data.hitCount) || 0,
    source: data.source ?? null,
    operation: normalizeOperation(data.operation),
    items,
    aliasesPromotedAt: data.aliasesPromotedAt ?? null,
    ...(seeded ? { seeded: true, seededInRelease: data.seededInRelease ?? null } : {}),
  };
}

async function persistReboundLearnedItems(businessId, textKey, items) {
  if (!businessId || !textKey) return;
  const sanitized = sanitizeItems(items);
  if (!sanitized.length) return;

  const docId = docIdForKey(textKey);
  const cached = memoryGet(businessId, textKey);
  // Rebinds of a seeded learning belong on its seededIntents archive doc —
  // writing to intentLearnings would create a partial doc without textKey.
  const ref = cached?.origin === 'seed'
    ? seededIntentRef(businessId, cached.docId ?? docId)
    : intentLearningRef(businessId, docId);
  try {
    await ref.set({
      items: sanitized,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    if (cached) {
      memorySet(businessId, textKey, { ...cached, items: sanitized });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] rebind persist failed: ${err.message}`);
    }
  }
}

/**
 * Owner playground: existing learning row for phrase (exact, variant, or fuzzy key).
 */
async function lookupLearnedMeta(businessId, rawText) {
  if (!businessId || !rawText?.trim()) return null;
  await ensureSeedHydrated(businessId);

  const variants = intentLearnKeyVariants(rawText);
  for (const textKey of variants) {
    const hit = await loadLearnedOrSeededDoc(businessId, textKey);
    if (hit) return toLearnedMeta(hit);
  }

  const canonical = intentLearnKey(rawText);
  for (const cachedKey of memoryKeys(businessId)) {
    if (keysAreFuzzyMatch(canonical, cachedKey)) {
      const hit = await loadLearnedOrSeededDoc(businessId, cachedKey);
      if (hit) return toLearnedMeta(hit);
    }
  }

  await loadFuzzyIndexFromFirestore(businessId);
  for (const cachedKey of memoryKeys(businessId)) {
    if (keysAreFuzzyMatch(canonical, cachedKey)) {
      const hit = await loadLearnedOrSeededDoc(businessId, cachedKey);
      if (hit) return toLearnedMeta(hit);
    }
  }
  return null;
}

/**
 * Tier B → Tier A: return a prior validated parse (exact, legacy key, or fuzzy).
 * @returns {Promise<{ items: object[], partySize: number|null, operation: string }|null>}
 */
async function lookupLearnedIntent(businessId, rawText) {
  if (!businessId || !rawText?.trim()) return null;
  await ensureSeedHydrated(businessId);

  const variants = intentLearnKeyVariants(rawText);
  for (const textKey of variants) {
    const hit = await loadExactKey(businessId, textKey);
    if (hit) return hit;
  }

  const canonical = intentLearnKey(rawText);
  const fuzzyMem = findFuzzyMemoryHit(businessId, canonical);
  if (fuzzyMem) return fuzzyMem;

  await loadFuzzyIndexFromFirestore(businessId);
  return findFuzzyMemoryHit(businessId, canonical);
}

/**
 * Bump usage count when a prior learn replayed successfully (rules/LLM path skipped).
 * Fire-and-forget; drives auto-promote threshold.
 */
function recordLearnedIntentHit(businessId, rawText) {
  if (!businessId || !rawText?.trim()) return;

  const textKey = intentLearnKey(rawText);
  if (!textKey) return;

  const docId = docIdForKey(textKey);
  const cachedForKey = memoryGet(businessId, textKey);

  // Seed-origin hits count on the seededIntents archive doc. A blind merge-set
  // on intentLearnings would recreate stub docs (hitCount, no items) for every
  // replay of a moved learning.
  if (cachedForKey?.origin === 'seed') {
    const seedDocId = cachedForKey.docId ?? docId;
    void seededIntentRef(businessId, seedDocId).set({
      hitCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).then(() => {
      if (cachedForKey.items?.length && shouldPromoteAliases(cachedForKey.operation)) {
        scheduleAliasPromotion(businessId, seedDocId, textKey, cachedForKey.items, { seeded: true });
      }
    }).catch(err => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[intent-learning] seeded hit save failed: ${err.message}`);
      }
    });
    return;
  }

  const ref = intentLearningRef(businessId, docId);
  void ref.set({
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).then(async () => {
    const cached = memoryGet(businessId, textKey);
    if (cached?.items?.length && shouldPromoteAliases(cached.operation)) {
      scheduleAliasPromotion(businessId, docId, textKey, cached.items);
      return;
    }
    try {
      const snap = await ref.get();
      const data = snap.data();
      const items = sanitizeItems(data?.items);
      if (items.length && shouldPromoteAliases(data?.operation)) {
        scheduleAliasPromotion(businessId, docId, textKey, items);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[intent-learning] learned hit bump failed: ${err.message}`);
      }
    }
  }).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] learned hit save failed: ${err.message}`);
    }
  });
}

/**
 * Persist when a proposal was validated by menu match (rules or LLM).
 * Fire-and-forget; never blocks the customer path.
 */
function rememberValidatedIntent(businessId, rawText, intent, matched = null) {
  if (!businessId || !rawText?.trim() || !intent) return;
  if (intent.parsedBy === 'learned') {
    recordLearnedIntentHit(businessId, rawText);
    return;
  }

  const items = itemsFromMatched(matched, intent.items);
  if (!items.length) return;

  const textKey = intentLearnKey(rawText);
  if (!textKey) return;

  const operation = normalizeOperation(intent.operation);
  const source = intent.parsedBy === 'llm' ? 'llm' : 'rules';
  const payload = {
    items,
    partySize: intent.partySize ?? null,
    operation,
  };
  memorySet(businessId, textKey, payload);

  const docId = docIdForKey(textKey);
  const ref = intentLearningRef(businessId, docId);
  void ref.set({
    textKey,
    items,
    partySize: intent.partySize ?? null,
    operation,
    source,
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).then(() => {
    if (shouldPromoteAliases(operation)) {
      scheduleAliasPromotion(businessId, docId, textKey, items);
    }
  }).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] save failed: ${err.message}`);
    }
  });
}

/** Owner dashboard: seed a phrase → items mapping (rules test or manual pick). */
async function saveManualIntentLearning(businessId, rawText, items, { operation = 'add' } = {}) {
  return saveOwnerIntentLearning(businessId, rawText, items, { operation });
}

/**
 * Owner dashboard / playground: persist phrase mapping, optional correction metadata.
 */
async function saveOwnerIntentLearning(
  businessId,
  rawText,
  items,
  {
    operation = 'add',
    correction = null,
    correctedBy = null,
  } = {},
) {
  if (!businessId || !rawText?.trim()) {
    throw new Error('businessId and text are required');
  }
  const sanitized = sanitizeItems(items);
  if (!sanitized.length) throw new Error('At least one menu item is required');

  const textKey = intentLearnKey(rawText);
  if (!textKey) throw new Error('Phrase is empty after normalization');

  const op = normalizeOperation(operation);
  const hasCorrection = correction && typeof correction === 'object';
  const source = hasCorrection ? 'manual_correction' : 'manual';
  const docId = docIdForKey(textKey);
  const ref = intentLearningRef(businessId, docId);
  const payload = {
    items: sanitized,
    partySize: null,
    operation: op,
  };
  memorySet(businessId, textKey, payload);

  const doc = {
    textKey,
    items: sanitized,
    partySize: null,
    operation: op,
    source,
    hitCount: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (hasCorrection) {
    doc.correction = {
      parsedBy: correction.parsedBy ?? null,
      outcome: correction.outcome ?? null,
      originalItems: Array.isArray(correction.originalItems) ? correction.originalItems : [],
      correctedBy: correctedBy ?? correction.correctedBy ?? null,
      correctedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    doc.aliasesPromotedAt = admin.firestore.FieldValue.delete();
    doc.promotedAliases = admin.firestore.FieldValue.delete();
  }

  await ref.set(doc, { merge: true });

  // If this phrase ships in the baked seed, record an override so the seed
  // entry stops replaying (ignoreDisabled: must hold even while the kill
  // switch is on, or re-enabling would resurrect the old mapping).
  const seedEntry = seedEntryForKey(businessId, textKey, { ignoreDisabled: true });
  if (seedEntry) {
    await addSeedOverride(businessId, textKey, seedEntry.docId ?? null);
  }

  return { id: docId, textKey, items: sanitized, operation: op, source };
}

/** @deprecated use rememberValidatedIntent */
function rememberValidatedLlmIntent(businessId, rawText, intent) {
  if (intent?.parsedBy !== 'llm') return;
  rememberValidatedIntent(businessId, rawText, intent);
}

/**
 * Build deferred learning payload for a conversational basket mutation.
 * Committed on the next non-undo turn via commitBasketPendingLearning.
 */
function buildBasketPendingLearning({ businessId, text, parsed, applyResult }) {
  if (!businessId || !text?.trim() || !applyResult?.applied?.length) return null;

  const applied = applyResult.applied;
  const addKinds = applied.every(r => r.kind === 'add');
  const removeKinds = applied.every(r => r.kind === 'remove' || r.kind === 'clear');

  if (addKinds && parsed?.intent && parsed?.matched?.length) {
    if (isPartialBlobTrap(text, parsed.intent, parsed.matched)) return null;
    const intentItems = parsed.intent.items ?? [];
    if (intentItems.length === 1 && parsed.matched.length === 1
      && countDistinctProductStems(String(text).replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, '$1 $2')) >= 2) {
      return null;
    }
    if (intentItems.length > 1 && parsed.matched.length < intentItems.length) return null;
    const addOps = (parsed.ops ?? []).filter(o => o.type === 'add');
    if (intentItems.length > 1 && addOps.length < intentItems.length) return null;
    return {
      businessId,
      text: text.trim(),
      intent: parsed.intent,
      matched: parsed.matched,
    };
  }

  if (removeKinds) {
    const removedLines = applied.flatMap(r => r.removedLines ?? []);
    if (!removedLines.length) return null;
    const matched = removedLines.map(line => ({
      name: line.name,
      qty: line.qty ?? 1,
      menuItemId: line.menuItemId,
      rawName: parsed?.intent?.items?.[0]?.name ?? line.name,
    }));
    const intent = parsed?.intent ?? {
      parsedBy: 'rules',
      rawText: text.trim(),
      operation: 'remove',
      partySize: null,
      items: matched.map(m => ({ name: m.rawName ?? m.name, qty: m.qty })),
    };
    return {
      businessId,
      text: text.trim(),
      intent: { ...intent, operation: 'remove' },
      matched,
    };
  }

  return null;
}

/** Persist a deferred basket mutation learning row (fire-and-forget). */
function commitBasketPendingLearning(pending) {
  if (!pending?.businessId || !pending.text) return;
  rememberValidatedIntent(
    pending.businessId,
    pending.text,
    pending.intent,
    pending.matched,
  );
}

/** Test helper */
function _resetIntentLearningMemory() {
  memoryByBusiness.clear();
  fuzzyIndexLoaded.clear();
  seedHydrated.clear();
  seedOverridesCache.clear();
}

module.exports = {
  intentLearnKey,
  intentLearnKeyVariants,
  lookupLearnedIntent,
  lookupLearnedMeta,
  ensureSeedHydrated,
  addSeedOverride,
  persistReboundLearnedItems,
  rememberValidatedIntent,
  rememberValidatedLlmIntent,
  buildBasketPendingLearning,
  commitBasketPendingLearning,
  recordLearnedIntentHit,
  saveManualIntentLearning,
  saveOwnerIntentLearning,
  normalizeOperation,
  ensureSeedHydrated,
  addSeedOverride,
  _resetIntentLearningMemory,
};
