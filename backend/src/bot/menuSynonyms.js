// Customer-facing terms that mean the same dish in TR/DE kebab shops.
// Normalized keys; expandNeedle() adds every term in a group when one matches.
const SYNONYM_GROUPS = [
  ['doner', 'döner', 'kebap', 'kebab', 'kabap', 'durum', 'dürüm'],
  ['cola', 'kola', 'coke'],
  ['ayran'],
  ['pizza'],
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

function termMatchesNeedle(needle, term) {
  if (needle === term) return true;
  // Multi-word phrases only match when the full phrase appears (not bare "pizza" → lahmacun).
  if (term.includes(' ')) return needle.includes(term);
  return needle === term || needle.startsWith(`${term} `) || needle.endsWith(` ${term}`);
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

module.exports = { SYNONYM_GROUPS, expandNeedle };
