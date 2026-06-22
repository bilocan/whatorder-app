// Pure menu matching helpers (no Firestore). Used by menuService and intentMatcher.

const { expandNeedle } = require('./menuSynonyms');

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
  const needles = expandNeedle(rawName);
  if (!needles.length) return undefined;

  let best;
  let bestScore = 0;
  for (const item of menuItems) {
    for (const candidate of [item.name, ...(item.aliases ?? [])]) {
      const c = norm(candidate);
      for (const needle of needles) {
        const score = scoreMatch(needle, c);
        if (score > bestScore) {
          bestScore = score;
          best = item;
        }
      }
    }
  }
  return bestScore > 0 ? best : undefined;
}

const AMBIGUITY_SCORE_GAP = 25;
const MIN_MATCH_SCORE = 10;
const MAX_AMBIGUOUS_RESULTS = 8;

function scoreItemForNeedle(item, needles) {
  const list = Array.isArray(needles) ? needles : expandNeedle(needles);
  let bestScore = 0;
  for (const needle of list) {
    for (const candidate of [item.name, ...(item.aliases ?? [])]) {
      bestScore = Math.max(bestScore, scoreMatch(needle, norm(candidate)));
    }
  }
  return bestScore;
}

/** Returns unique match, ambiguous list (≤8), or none — for Layer 1 disambiguation. */
function classifyMenuMatch(rawName, menuItems) {
  const needles = expandNeedle(rawName);
  if (!needles.length) return { type: 'none' };

  const available = menuItems.filter(i => i.available !== false);

  // Multiple names sharing the same stem (e.g. "döner" → Döner, Döner Box; or kebap variants)
  const stemHits = available.filter(item => {
    const n = norm(item.name);
    return needles.some(needle =>
      n === needle || n.startsWith(`${needle} `) || n.startsWith(needle) || n.includes(` ${needle}`),
    );
  });
  if (stemHits.length > 1) {
    return { type: 'ambiguous', items: stemHits.slice(0, MAX_AMBIGUOUS_RESULTS), rawName };
  }
  if (stemHits.length === 1) return { type: 'unique', item: stemHits[0] };

  const scored = available
    .map(item => ({ item, score: scoreItemForNeedle(item, needles) }))
    .filter(x => x.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { type: 'none' };
  if (scored.length === 1) return { type: 'unique', item: scored[0].item };

  const topScore = scored[0].score;
  if (topScore - scored[1].score >= AMBIGUITY_SCORE_GAP) {
    return { type: 'unique', item: scored[0].item };
  }

  const topTier = scored.filter(x => x.score >= topScore - AMBIGUITY_SCORE_GAP);
  if (topTier.length === 1) return { type: 'unique', item: topTier[0].item };

  return {
    type: 'ambiguous',
    items: topTier.slice(0, MAX_AMBIGUOUS_RESULTS).map(x => x.item),
    rawName,
  };
}

module.exports = { norm, matchMenuItem, classifyMenuMatch, scoreMatch };
