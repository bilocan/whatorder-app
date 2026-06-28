const { extractDishNameForMatch } = require('./intentModifiers');
const { tokensOf } = require('./menuMapper');
const { typoTolerantWordMatch } = require('./menuSynonyms');

const MIN_TOKEN_OVERLAP_SCORE = 82;
const MIN_QUERY_TOKENS = 1;

function collectItemTokens(item) {
  const labels = [item.name, ...(item.aliases ?? [])].filter(Boolean);
  const tokens = new Set();
  for (const label of labels) {
    for (const token of tokensOf(label)) tokens.add(token);
  }
  return [...tokens];
}

/**
 * Per-restaurant inverted token index for menu-first matching.
 * @param {object[]} menuItems
 */
function buildMenuTokenIndex(menuItems) {
  return (menuItems ?? [])
    .filter(i => i.available !== false)
    .map(item => ({
      item,
      tokens: collectItemTokens(item),
    }));
}

function tokenMatchesQuery(queryToken, itemToken) {
  if (!queryToken || !itemToken) return false;
  if (queryToken === itemToken) return true;
  return typoTolerantWordMatch(queryToken, itemToken);
}

function scoreTokenOverlap(queryTokens, itemTokens) {
  if (!queryTokens.length || !itemTokens.length) return 0;
  let hits = 0;
  for (const qt of queryTokens) {
    if (itemTokens.some(it => tokenMatchesQuery(qt, it))) hits += 1;
  }
  if (!hits) return 0;
  if (hits === queryTokens.length && hits === itemTokens.length) return 100;
  if (hits === queryTokens.length) return 88;
  const coverage = hits / queryTokens.length;
  if (coverage >= 0.75 && queryTokens.length >= 2) return 84;
  if (hits >= 1 && queryTokens.length === 1) return 82;
  return 0;
}

/**
 * Score customer dish text against menu token index.
 * @returns {{ item: object, score: number }[]}
 */
function findTokenIndexMatches(rawName, tokenIndex, menuItems = null) {
  const dishName = extractDishNameForMatch(rawName) || (rawName ?? '').trim();
  const queryTokens = tokensOf(dishName).filter(t => t.length >= 2);
  if (queryTokens.length < MIN_QUERY_TOKENS) return [];

  const index = tokenIndex ?? buildMenuTokenIndex(menuItems ?? []);
  const scored = index
    .map(({ item, tokens }) => ({ item, score: scoreTokenOverlap(queryTokens, tokens) }))
    .filter(x => x.score >= MIN_TOKEN_OVERLAP_SCORE)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  const top = scored[0].score;
  return scored.filter(x => x.score >= top - 5);
}

module.exports = {
  buildMenuTokenIndex,
  findTokenIndexMatches,
  collectItemTokens,
  scoreTokenOverlap,
};
