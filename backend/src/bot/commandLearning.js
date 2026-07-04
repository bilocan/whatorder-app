const crypto = require('crypto');
const { admin } = require('../lib/firebase');
const { commandLearningRef } = require('../lib/collections');
const { intentLearnKey } = require('./intentNormalize');

/** In-process L1: normalized text key → command id (view_basket | undo). */
const memoryCache = new Map();

const ALLOWED_COMMANDS = new Set(['view_basket', 'undo']);

function docIdForKey(textKey) {
  return crypto.createHash('sha256').update(textKey).digest('hex').slice(0, 40);
}

function sanitizeCommand(command) {
  const cmd = String(command ?? '').toLowerCase().trim();
  return ALLOWED_COMMANDS.has(cmd) ? cmd : null;
}

function memoryGet(textKey) {
  return memoryCache.get(textKey) ?? null;
}

function memorySet(textKey, command) {
  const cmd = sanitizeCommand(command);
  if (!textKey || !cmd) return;
  memoryCache.set(textKey, cmd);
}

async function loadFromFirestore(textKey) {
  const cached = memoryGet(textKey);
  if (cached) return cached;

  try {
    const snap = await commandLearningRef(docIdForKey(textKey)).get();
    if (!snap.exists) return null;

    const command = sanitizeCommand(snap.data()?.command);
    if (!command) return null;

    memorySet(textKey, command);
    return command;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[command-learning] lookup failed: ${err.message}`);
    }
    return null;
  }
}

async function lookupLearnedCommand(text) {
  const key = intentLearnKey(text);
  if (!key) return null;

  const cached = memoryGet(key);
  if (cached) return cached;

  return loadFromFirestore(key);
}

function recordLearnedCommandHit(text) {
  const key = intentLearnKey(text);
  if (!key) return;

  const ref = commandLearningRef(docIdForKey(key));
  void ref.set({
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[command-learning] hit bump failed: ${err.message}`);
    }
  });
}

/**
 * Persist LLM-classified command phrase. Fire-and-forget; never blocks the customer path.
 */
async function rememberLearnedCommand(text, command, { source = 'llm' } = {}) {
  const key = intentLearnKey(text);
  const cmd = sanitizeCommand(command);
  if (!key || !cmd) return;

  memorySet(key, cmd);

  const ref = commandLearningRef(docIdForKey(key));
  void ref.set({
    textKey: key,
    command: cmd,
    source,
    hitCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).catch(err => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[command-learning] save failed: ${err.message}`);
    }
  });
}

function _resetCommandCache() {
  memoryCache.clear();
}

module.exports = {
  lookupLearnedCommand,
  rememberLearnedCommand,
  recordLearnedCommandHit,
  _resetCommandCache,
};
