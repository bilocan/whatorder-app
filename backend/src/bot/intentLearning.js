const crypto = require('crypto');
const { admin } = require('../lib/firebase');
const { intentLearningRef } = require('../lib/collections');

/** In-process L1: businessId → Map(textKey → intent payload). */
const memoryByBusiness = new Map();

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

/** Same normalization as parseIntent input — keys repeat utterances reliably. */
function intentLearnKey(text) {
  let s = (text ?? '').trim();
  s = s.replace(/\bfor\s+\d+\s*(?:people|persons|person|p)?\b/gi, ' ');
  s = s.replace(/\bfür\s+\d+\s*(?:personen|leute|p)?\b/gi, ' ');
  s = s.replace(/^\s*(zum mitnehmen|zum essen|takeaway|to go|abholen)\s*,?\s*/i, '');
  s = s.replace(
    /^\s*ich\s+(?:hätte|hatte|möchte|moechte|will|würde|wuerde)\s+(?:gerne\s+)?/i,
    '',
  );
  s = s.replace(/^\s*hätte\s+gerne\s+/i, '');
  s = s.replace(/^\s*(?:was\s+)?für\s+mich\s+/i, '');
  s = s.replace(/^\s*noch\s+(?:ein|eine|einen|einer|dazu)\s+/i, '');
  s = s.replace(/^\s*(?:auch|nochmal)\s+(?:ein|eine|einen|einer)\s+/i, '');
  return norm(s.replace(/\s+/g, ' ').trim());
}

function docIdForKey(textKey) {
  return crypto.createHash('sha256').update(textKey).digest('hex').slice(0, 40);
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

function sanitizeItems(items) {
  return (items ?? [])
    .filter(i => i && typeof (i.name ?? i.rawName) === 'string')
    .map(i => ({
      name: String(i.name ?? i.rawName).trim(),
      qty: Math.min(99, Math.max(1, Number(i.qty) || 1)),
    }))
    .filter(i => i.name);
}

/**
 * Tier B → Tier A: return a prior LLM parse validated by menu match.
 * @returns {{ items: { name: string, qty: number }[], partySize: number|null }|null}
 */
async function lookupLearnedIntent(businessId, rawText) {
  if (!businessId || !rawText?.trim()) return null;

  const textKey = intentLearnKey(rawText);
  if (!textKey) return null;

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
 * Persist when LLM structured an order and menu matching succeeded.
 * Fire-and-forget; never blocks the customer path.
 */
function rememberValidatedLlmIntent(businessId, rawText, intent) {
  if (!businessId || !rawText?.trim() || intent?.parsedBy !== 'llm') return;

  const items = sanitizeItems(intent.items);
  if (!items.length) return;

  const textKey = intentLearnKey(rawText);
  if (!textKey) return;

  const payload = {
    items,
    partySize: intent.partySize ?? null,
  };
  memorySet(businessId, textKey, payload);

  const ref = intentLearningRef(businessId, docIdForKey(textKey));
  void ref.set({
    textKey,
    items,
    partySize: intent.partySize ?? null,
    source: 'llm',
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[intent-learning] save failed: ${err.message}`);
    }
  });
}

/** Test helper */
function _resetIntentLearningMemory() {
  memoryByBusiness.clear();
}

module.exports = {
  intentLearnKey,
  lookupLearnedIntent,
  rememberValidatedLlmIntent,
  _resetIntentLearningMemory,
};
