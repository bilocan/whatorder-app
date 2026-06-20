// Pure menu matching helpers (no Firestore). Used by menuService and intentMatcher.

function norm(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

function scoreMatch(needle, candidate) {
  if (!candidate) return 0;
  if (needle === candidate) return 100;
  const wordRe = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (wordRe.test(needle)) return 80;
  if (candidate.startsWith(needle) || needle.startsWith(candidate)) return 50;
  if (candidate.includes(needle) || needle.includes(candidate)) return 10;
  return 0;
}

function matchMenuItem(rawName, menuItems) {
  const needle = norm(rawName);
  if (!needle) return undefined;

  let best;
  let bestScore = 0;
  for (const item of menuItems) {
    for (const candidate of [item.name, ...(item.aliases ?? [])]) {
      const score = scoreMatch(needle, norm(candidate));
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }
  return bestScore > 0 ? best : undefined;
}

module.exports = { norm, matchMenuItem };
