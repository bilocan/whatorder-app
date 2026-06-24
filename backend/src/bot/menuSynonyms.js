// Customer-facing terms that mean the same dish in TR/DE kebab shops.
// Normalized keys; expandNeedle() adds every term in a group when one matches.
const SYNONYM_GROUPS = [
  ['doner', 'döner', 'kebap', 'kebab', 'kabap', 'durum', 'dürüm'],
  ['huhn', 'huhner', 'hühner', 'chicken', 'hahnchen', 'hähnchen', 'tavuk'],
  ['cola', 'kola', 'coke'],
  ['ayran'],
  ['pizza'],
  ['margherita', 'margarita', 'margarete', 'margareta'],
  ['spinaci', 'spinati', 'spinachi'],
  ['familienpizza', 'familien pizza', 'grosse pizza', 'große pizza', 'family pizza'],
  ['ayran', 'ayram', 'jogurt', 'joghurt'],
  ['lahmacun', 'turkish pizza', 'turkische pizza', 'turk pizzasi', 'turk pizzası'],
  ['pide'],
];

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
  return [...expanded];
}

module.exports = {
  SYNONYM_GROUPS,
  expandNeedle,
  wordMatchesInText,
  containsWord,
  splitCompoundDish,
  typoTolerantWordMatch,
  nameTokens,
  levenshtein,
};
