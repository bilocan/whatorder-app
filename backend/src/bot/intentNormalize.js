/** Shared text normalization for intent parsing, learning keys, and menu matching. */

const QTY_WORD_TO_DIGIT = {
  ein: '1',
  eine: '1',
  eins: '1',
  einen: '1',
  einer: '1',
  zwei: '2',
  drei: '3',
  vier: '4',
  funf: '5',
  fünf: '5',
  sechs: '6',
  bir: '1',
  iki: '2',
  uc: '2',
  'üç': '3',
  dort: '4',
  'dört': '4',
  bes: '5',
  'beş': '5',
};

const PARTY_SIZE_RE = [
  /\bfor\s+\d+\s*(?:people|persons|person|p)?\b/gi,
  /\bfür\s+\d+\s*(?:personen|leute|p)?\b/gi,
  /\b(\d+)\s*(?:people|persons|person|personen|leute|p)\b/gi,
  /\b(\d+)\s*(?:kişi|kisi)\b/gi,
  /\b(bir|iki|üç|uc|dört|dort|beş|bes)\s*(?:kişi|kisi|person|personen)\b/gi,
];

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

function normalizeQtyWords(text) {
  return String(text ?? '').replace(
    /\b(ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs|bir|iki|uc|üç|dort|dört|bes|beş)\b/gi,
    (m) => QTY_WORD_TO_DIGIT[m.toLowerCase()] ?? m,
  );
}

function stripPartySizePhrases(text) {
  let out = text ?? '';
  for (const re of PARTY_SIZE_RE) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function stripOrderTypePrefix(text) {
  return (text ?? '')
    .replace(/^\s*(zum mitnehmen|zum essen|takeaway|to go|abholen)\s*,?\s*/i, '')
    .trim();
}

function stripPolitePrefix(text) {
  return (text ?? '')
    .replace(/^\s*hallo\s+/i, '')
    .replace(
      /^\s*(?:ich|wir)\s+(?:hätte|hatte|hätten|hatten|möchte|moechte|möchten|moechten|will|wollen|würde|wuerde|würden|wuerden)\s+(?:gerne\s+)?/i,
      '',
    )
    .replace(/^\s*hätte\s+gerne\s+/i, '')
    .trim();
}

function stripContinuationPrefix(text) {
  return (text ?? '')
    .replace(/^\s*noch\s+(?:ein|eine|einen|einer|dazu)\s+/i, '')
    .replace(/^\s*(?:auch|nochmal)\s+(?:ein|eine|einen|einer)\s+/i, '')
    .trim();
}

function stripSelfOrderFiller(text) {
  return (text ?? '')
    .replace(/^\s*(?:was\s+)?für\s+mich\s+/i, '')
    .trim();
}

/** Prefixes stripped before parse and before intent learning keys. */
function stripIntentPrefixes(text) {
  let s = (text ?? '').trim();
  s = stripPartySizePhrases(s);
  s = stripOrderTypePrefix(s);
  s = stripPolitePrefix(s);
  s = stripContinuationPrefix(s);
  s = stripSelfOrderFiller(s);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical key for intentLearnings — digits for qty words, diacritics stripped.
 * @param {string} text
 * @param {{ legacyQty?: boolean }} [opts] legacyQty=true skips digit normalization (pre-2.0 keys)
 */
function intentLearnKey(text, { legacyQty = false } = {}) {
  let s = stripIntentPrefixes(text);
  s = s.replace(/\s+bitte\s*$/i, '').trim();
  s = norm(s);
  if (!legacyQty) s = normalizeQtyWords(s);
  return s.replace(/\s+/g, ' ').trim();
}

/** Exact lookup variants: canonical + legacy qty wording. */
function intentLearnKeyVariants(text) {
  const canonical = intentLearnKey(text);
  const legacy = intentLearnKey(text, { legacyQty: true });
  return [...new Set([canonical, legacy].filter(Boolean))];
}

/** Shared pre-parse text prep (party size left in body for parseIntent). */
function prepareOrderText(text) {
  let s = (text ?? '').trim();
  s = stripOrderTypePrefix(s);
  s = stripPolitePrefix(s);
  s = stripContinuationPrefix(s);
  return s.replace(/\s+/g, ' ').trim();
}

module.exports = {
  norm,
  normalizeQtyWords,
  stripPartySizePhrases,
  stripOrderTypePrefix,
  stripPolitePrefix,
  stripContinuationPrefix,
  stripIntentPrefixes,
  intentLearnKey,
  intentLearnKeyVariants,
  prepareOrderText,
};
