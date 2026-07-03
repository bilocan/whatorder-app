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

/**
 * Tier B → Tier A: return a prior validated parse (exact, legacy key, or fuzzy).
 * @returns {Promise<{ items: object[], partySize: number|null, operation: string }|null>}
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

  return { id: docId, textKey, items: sanitized, operation: op, source };
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
  saveManualIntentLearning,
  saveOwnerIntentLearning,
  normalizeOperation,
  _resetIntentLearningMemory,
};
