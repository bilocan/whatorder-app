// Customer-facing terms that mean the same dish in TR/DE kebab shops.
// Normalized keys; expandNeedle() adds every term in a group when one matches.
const SYNONYM_GROUPS = [
  ['doner', 'döner', 'kebap', 'kebab', 'kabap', 'durum', 'dürüm'],
  ['huhn', 'huhner', 'hühner', 'chicken', 'hahnchen', 'hähnchen', 'tavuk'],
  ['cola', 'kola', 'coke'],
  ['eistee', 'eis tee', 'icetea', 'ice tea', 'ice-tea', 'soguk cay', 'buzlu cay'],
  ['ayran'],
  ['pizza'],
  ['margherita', 'margarita', 'margarete', 'margareta'],
  ['spinaci', 'spinati', 'spinachi'],
  ['tonno', 'thunfisch', 'tuna'],
  ['familienpizza', 'familien pizza', 'grosse pizza', 'große pizza', 'family pizza'],
  ['ayran', 'ayram', 'jogurt', 'joghurt'],
  ['lahmacun', 'turkish pizza', 'turkische pizza', 'turk pizzasi', 'turk pizzası'],
  ['pide'],
  ['pfirsich', 'peach', 'seftali'],
  ['zitrone', 'lemon', 'limon'],
  ['pommes', 'fries', 'patates'],
  ['cheeseburger', 'cheese burger', 'kasarli burger'],
  ['hamburger', 'ham burger'],
  ['sandwich', 'sandvic'],
  ['falafel'],
  ['corba', 'corbasi', 'suppe', 'soup'],
  ['wasser', 'water', 'su'],
  ['bier', 'beer', 'bira'],
  ['fanta'],
  ['sprite'],
  ['gross', 'grosse', 'groß', 'large', 'buyuk'],
  ['klein', 'small', 'kucuk'],
];

/** Min scoreStemTypo() to expand a token into a synonym group (typo / TTS near-miss). */
const MIN_FUZZY_SYNONYM_SCORE = 60;

function norm(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

function containsWord(text, term) {
  const t = norm(term);
  if (!t || !text) return false;
  const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return re.test(text);
}

function termMatchesNeedle(needle, term) {
  if (needle === term) return true;
  // Multi-word phrases only match when the full phrase appears (not bare "pizza" → lahmacun).
  if (term.includes(' ')) return needle.includes(term);
  if (containsWord(needle, term)) return true;
  return needle.startsWith(`${term} `) || needle.endsWith(` ${term}`);
}

/**
 * TTS / fast speech often glues protein + dish: "hühnerkebab", "huhnerdoner".
 * Returns normalized token pair or null.
 */
function splitCompoundDish(normText) {
  const n = norm(normText);
  if (!n) return null;
  const m = n.match(
    /^(huhn(?:er)?|hahnchen|chicken|tavuk)(kebap|kebab|kabap|doner|durum|sandwich|box|teller|pizza|pide)$/,
  );
  if (!m) return null;
  return [m[1], m[2]];
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function maxTypoDistance(a, b) {
  const len = Math.max(a.length, b.length);
  if (len < 5) return 0;
  if (len <= 8) return 1;
  return 2;
}

/** One-edit (or two for long tokens) tolerance — e.g. spinaci ↔ spinachi, Margarita ↔ Margherita. */
function typoTolerantWordMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (containsWord(x, y) || containsWord(y, x)) return true;
  const maxDist = maxTypoDistance(x, y);
  if (!maxDist) return false;
  return levenshtein(x, y) <= maxDist;
}

function nameTokens(text) {
  return norm(text)
    .split(/[^a-z0-9äöüß]+/i)
    .filter(w => w.length >= 5 && !/^\d+$/.test(w));
}

/** True when word (or a synonym) appears as a word in textNorm. */
function wordMatchesInText(word, textNorm) {
  const w = norm(word);
  if (!w || !textNorm) return false;
  if (containsWord(textNorm, w)) return true;
  for (const group of SYNONYM_GROUPS) {
    const terms = group.map(norm);
    if (!terms.some(t => containsWord(w, t) || w === t)) continue;
    if (terms.some(t => containsWord(textNorm, t))) return true;
  }
  if (nameTokens(textNorm).some(t => typoTolerantWordMatch(w, t))) return true;
  return false;
}

function collapsedStem(str) {
  return norm(str).replace(/\s+/g, '');
}

/** Score a customer token against a known synonym stem (0–100). */
function scoreStemTypo(a, b) {
  const x = collapsedStem(a);
  const y = collapsedStem(b);
  if (!x || !y) return 0;
  if (x === y) return 100;
  if (typoTolerantWordMatch(x, y)) return 78;
  const maxDist = maxTypoDistance(x, y);
  if (maxDist && levenshtein(x, y) <= maxDist) return 76;
  return scoreSharedSuffixTypo(a, b);
}

/**
 * TTS often garbles the prefix but keeps the dish suffix (cheeseburger → chisburger).
 * Compare edit distance on the prefix when both strings share a long suffix.
 */
function scoreSharedSuffixTypo(a, b, minSuffix = 4) {
  const x = collapsedStem(a);
  const y = collapsedStem(b);
  if (!x || !y || x.length < minSuffix + 2 || y.length < minSuffix + 2) return 0;

  let suffixLen = 0;
  while (
    suffixLen < x.length
    && suffixLen < y.length
    && x[x.length - 1 - suffixLen] === y[y.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }
  if (suffixLen < minSuffix) return 0;

  const xPrefix = x.slice(0, -suffixLen);
  const yPrefix = y.slice(0, -suffixLen);
  if (!xPrefix.length || !yPrefix.length) return 100;
  if (xPrefix === yPrefix) return 100;

  const maxPrefix = Math.max(xPrefix.length, yPrefix.length);
  const maxDist = suffixLen >= 5 ? 3 : maxPrefix <= 4 ? 1 : 2;
  const dist = levenshtein(xPrefix, yPrefix);
  if (dist > maxDist) return 0;
  // TTS keeps suffix + often first syllable (chisburger ↔ cheeseburger, not hamburger).
  let prefixCommon = 0;
  while (
    prefixCommon < xPrefix.length
    && prefixCommon < yPrefix.length
    && xPrefix[prefixCommon] === yPrefix[prefixCommon]
  ) {
    prefixCommon += 1;
  }
  if (maxDist >= 3 && prefixCommon < 2) return 0;
  return Math.max(MIN_FUZZY_SYNONYM_SCORE, 76 - dist);
}

function tokensForFuzzyExpand(normPhrase) {
  return normPhrase.split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w));
}

function tokenHasExactSynonymCoverage(token, expanded) {
  const t = norm(token);
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map(norm);
    if (!normalized.includes(t)) continue;
    if (normalized.some(term => expanded.has(term))) return true;
  }
  return false;
}

function fuzzyExpandSynonymGroups(token, expanded, minScore = MIN_FUZZY_SYNONYM_SCORE) {
  if (tokenHasExactSynonymCoverage(token, expanded)) return;
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map(norm);
    const best = normalized.reduce((max, term) => Math.max(max, scoreStemTypo(token, term)), 0);
    if (best >= minScore) normalized.forEach(term => expanded.add(term));
  }
}

/** All normalized terms in the same synonym group as token, or null. */
function synonymGroupForToken(token) {
  const t = norm(token);
  if (!t) return null;
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map(norm);
    if (normalized.includes(t)) return normalized;
  }
  return null;
}

function expandNeedle(rawName) {
  const n = norm(rawName);
  if (!n) return [];
  const expanded = new Set([n]);
  const compound = splitCompoundDish(n);
  if (compound) compound.forEach(term => expanded.add(term));
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map(norm);
    if (normalized.some(term => termMatchesNeedle(n, term))) {
      normalized.forEach(term => expanded.add(term));
    }
  }
  for (const token of tokensForFuzzyExpand(n)) {
    fuzzyExpandSynonymGroups(token, expanded);
  }
  return [...expanded];
}

module.exports = {
  SYNONYM_GROUPS,
  MIN_FUZZY_SYNONYM_SCORE,
  expandNeedle,
  wordMatchesInText,
  containsWord,
  splitCompoundDish,
  typoTolerantWordMatch,
  scoreStemTypo,
  synonymGroupForToken,
  nameTokens,
  levenshtein,
  maxTypoDistance,
};
