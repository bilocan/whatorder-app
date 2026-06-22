// Customer-facing terms that mean the same dish in TR/DE kebab shops.
// Normalized keys; expandNeedle() adds every term in a group when one matches.
const SYNONYM_GROUPS = [
  ['doner', 'döner', 'kebap', 'kebab', 'kabap', 'durum', 'dürüm'],
  ['huhn', 'huhner', 'hühner', 'chicken', 'hahnchen', 'hähnchen', 'tavuk'],
  ['cola', 'kola', 'coke'],
  ['ayran'],
  ['pizza'],
  ['margherita', 'margarita', 'margarete', 'margareta'],
  ['spinaci', 'spinati'],
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
  return false;
}

function expandNeedle(rawName) {
  const n = norm(rawName);
  if (!n) return [];
  const expanded = new Set([n]);
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map(norm);
    if (normalized.some(term => termMatchesNeedle(n, term))) {
      normalized.forEach(term => expanded.add(term));
    }
  }
  return [...expanded];
}

module.exports = { SYNONYM_GROUPS, expandNeedle, wordMatchesInText, containsWord };
