const { norm: normText } = require('./intentNormalize');
const { canCallLlm, parseBotCommandWithLlm } = require('../lib/llm');
const { lookupLearnedCommand, rememberLearnedCommand, recordLearnedCommandHit } = require('./commandLearning');

const BOT_COMMAND = {
  VIEW_BASKET: 'view_basket',
  UNDO: 'undo',
};

const VIEW_BASKET_PHRASES = new Set([
  'basket', 'sepet', 'warenkorb', 'view basket', 'show basket', 'my basket', 'open basket',
  'cart', 'view cart', 'show cart', 'my cart',
  'was hab ich', 'was habe ich', 'was ist in meinem warenkorb', 'was ist im warenkorb',
  'mein warenkorb', 'zeig mir den warenkorb', 'zeig den warenkorb', 'zeig warenkorb',
  'warenkorb anzeigen', 'warenkorb zeigen',
  'sepeti goster', 'sepeti göster', 'sepetim', 'sepetimi goster', 'sepetimi göster',
  'what did i order', 'whats in my basket', "what's in my basket", 'whats in my cart',
]);

const UNDO_PHRASES = new Set([
  'ruckgangig', 'undo', 'geri al',
  'rueckgaengig', 'ruckgaengig machen', 'mach rueckgaengig', 'mache rueckgaengig',
  'letzte aenderung rueckgaengig', 'letzte änderung rückgängig',
]);

/** Only treat as undo when a snapshot exists (avoid clash with restaurant switch / search back). */
const UNDO_CONTEXT_PHRASES = new Set([
  'zuruck', 'back', 'go back', 'take back', 'revert', 'widerrufen',
]);

const VIEW_BASKET_PREFIX_RE = /^(?:zeig(?:en|)\s+(?:mir\s+)?(?:den\s+)?|show\s+|view\s+|open\s+|see\s+)(?:warenkorb|basket|cart|sepet)\b/;
const VIEW_BASKET_QUESTION_RE = /^(?:was|what)\s+(?:hab(?:e|)\s+ich|ist\s+(?:in\s+)?(?:meinem\s+)?(?:warenkorb|basket|cart|sepet)|did\s+i\s+order|s?\s+in\s+my\s+(?:basket|cart))\b/;
const UNDO_PREFIX_RE = /^(?:mach(?:e|)\s+|bitte\s+)?(?:ruckgangig|rueckgaengig|rückgängig|undo)\b/;

const ORDER_SIGNAL_RE = /(\d+\s*x\b|\bx\s*\d+|\d+\s+\w|\+\s*\w|,\s*\w|\bund\b|\band\b|\bve\b|\bmit\b|\bwith\b)/i;

function normalizeCommandInput(text) {
  return normText((text ?? '').trim());
}

function detectViewBasketRules(normalized) {
  if (!normalized) return false;
  if (VIEW_BASKET_PHRASES.has(normalized)) return true;
  if (VIEW_BASKET_PREFIX_RE.test(normalized)) return true;
  if (VIEW_BASKET_QUESTION_RE.test(normalized)) return true;
  return false;
}

function detectUndoRules(normalized, ctx = {}) {
  if (!normalized) return false;
  if (UNDO_PHRASES.has(normalized)) return true;
  if (UNDO_PREFIX_RE.test(normalized)) return true;
  if (ctx.hasUndoSnapshot && UNDO_CONTEXT_PHRASES.has(normalized)) return true;
  return false;
}

/**
 * Fast rule-based command detection (sync).
 * @returns {{ command: string, source: 'rules' } | null}
 */
function detectBotCommandRules(text, ctx = {}) {
  const normalized = normalizeCommandInput(text);
  if (!normalized) return null;

  if (detectViewBasketRules(normalized)) {
    return { command: BOT_COMMAND.VIEW_BASKET, source: 'rules' };
  }
  if (detectUndoRules(normalized, ctx)) {
    return { command: BOT_COMMAND.UNDO, source: 'rules' };
  }
  return null;
}

function mightBeBotCommand(text, normalized) {
  const trimmed = (text ?? '').trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (ORDER_SIGNAL_RE.test(trimmed)) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 8;
}

/**
 * Sync guard for order-intent paths — rules + learned keys already hot in memory from prior turns.
 */
function isBotCommandPhrase(text, normIn) {
  const normalized = normIn ?? normalizeCommandInput(text);
  if (detectBotCommandRules(text, {})) return true;
  if (detectViewBasketRules(normalized)) return true;
  if (UNDO_PHRASES.has(normalized)) return true;
  return false;
}

function isBasketUndoPhrase(norm, ctx = {}) {
  const normalized = normalizeCommandInput(norm);
  return detectUndoRules(normalized, ctx);
}

/**
 * Rules → cache → LLM for short ambiguous phrases (e.g. colloquial undo / basket requests).
 * @returns {Promise<{ command: string, source: 'rules'|'learned'|'llm' } | null>}
 */
async function detectBotCommandAsync(text, {
  phone = 'sandbox',
  hasUndoSnapshot = false,
  hasBasket = false,
} = {}) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const ctx = { hasUndoSnapshot };
  const rulesHit = detectBotCommandRules(trimmed, ctx);
  if (rulesHit) return rulesHit;

  if (!mightBeBotCommand(trimmed, normalizeCommandInput(trimmed))) return null;

  const learned = await lookupLearnedCommand(trimmed);
  if (learned) {
    if (learned === BOT_COMMAND.UNDO && !hasUndoSnapshot) return null;
    recordLearnedCommandHit(trimmed);
    return { command: learned, source: 'learned' };
  }

  if (!canCallLlm(phone)) return null;

  const llm = await parseBotCommandWithLlm(trimmed, {
    phone,
    hasUndoSnapshot,
    hasBasket,
  });
  if (!llm?.command || llm.command === 'none' || llm.confidence < 0.85) return null;
  if (llm.command === BOT_COMMAND.UNDO && !hasUndoSnapshot) return null;

  void rememberLearnedCommand(trimmed, llm.command);
  return { command: llm.command, source: 'llm' };
}

module.exports = {
  BOT_COMMAND,
  detectBotCommandRules,
  detectBotCommandAsync,
  isBotCommandPhrase,
  isBasketUndoPhrase,
  mightBeBotCommand,
};
