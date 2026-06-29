const crypto = require('crypto');
const { admin } = require('../lib/firebase');
const { intentLearningRef } = require('../lib/collections');
const { intentLearnKey, intentLearnKeyVariants } = require('./intentNormalize');
const { levenshtein, maxTypoDistance } = require('./menuSynonyms');
const { scheduleAliasPromotion } = require('./intentLearningPromote');

/** In-process L1: businessId → Map(textKey → intent payload). */
const memoryByBusiness = new Map();
/** businessId → whether all Firestore keys were loaded for fuzzy scan. */
const fuzzyIndexLoaded = new Set();

const FUZZY_KEY_MAX_DIST = 3;
const FUZZY_MIN_KEY_LEN = 8;

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

function keysAreFuzzyMatch(a, b) {
  if (!a || !b || a === b) return a === b;
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
          items,
          partySize: data.partySize ?? null,
        });
      }
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] fuzzy index load failed: ${err.message}`);
    }
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
      items,
      partySize: data.partySize ?? null,
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

/**
 * Tier B → Tier A: return a prior validated parse (exact, legacy key, or fuzzy).
 * @returns {Promise<{ items: object[], partySize: number|null }|null>}
 */
async function lookupLearnedIntent(businessId, rawText) {
  if (!businessId || !rawText?.trim()) return null;

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
  const ref = intentLearningRef(businessId, docId);
  void ref.set({
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).then(async () => {
    const cached = memoryGet(businessId, textKey);
    if (cached?.items?.length) {
      scheduleAliasPromotion(businessId, docId, textKey, cached.items);
      return;
    }
    try {
      const snap = await ref.get();
      const items = sanitizeItems(snap.data()?.items);
      if (items.length) scheduleAliasPromotion(businessId, docId, textKey, items);
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

  const source = intent.parsedBy === 'llm' ? 'llm' : 'rules';
  const payload = {
    items,
    partySize: intent.partySize ?? null,
  };
  memorySet(businessId, textKey, payload);

  const docId = docIdForKey(textKey);
  const ref = intentLearningRef(businessId, docId);
  void ref.set({
    textKey,
    items,
    partySize: intent.partySize ?? null,
    source,
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).then(() => {
    scheduleAliasPromotion(businessId, docId, textKey, items);
  }).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] save failed: ${err.message}`);
    }
  });
}

/** @deprecated use rememberValidatedIntent */
function rememberValidatedLlmIntent(businessId, rawText, intent) {
  if (intent?.parsedBy !== 'llm') return;
  rememberValidatedIntent(businessId, rawText, intent);
}

/** Test helper */
function _resetIntentLearningMemory() {
  memoryByBusiness.clear();
  fuzzyIndexLoaded.clear();
}

module.exports = {
  intentLearnKey,
  intentLearnKeyVariants,
  lookupLearnedIntent,
  rememberValidatedIntent,
  rememberValidatedLlmIntent,
  recordLearnedIntentHit,
  _resetIntentLearningMemory,
};
