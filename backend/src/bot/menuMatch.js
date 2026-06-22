// Pure menu matching helpers (no Firestore). Used by menuService and intentMatcher.

const { expandNeedle, wordMatchesInText } = require('./menuSynonyms');
const { extractDishNameForMatch } = require('./intentModifiers');
const { trySmartDefault } = require('./smartDefaults');

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

function wantsFamilienPizza(dishName) {
  const n = norm(dishName);
  return n.includes('familienpizza') || n.includes('familien pizza');
}

/** Only narrow to pizza SKUs when the customer actually ordered pizza. */
function isPizzaQuery(dishName) {
  const n = norm(dishName);
  return n.includes('pizza') || wantsFamilienPizza(dishName);
}

function filterCandidatesForQuery(items, dishName) {
  if (!items.length) return items;

  if (isPizzaQuery(dishName)) {
    return applyPizzaSizePreference(items, dishName);
  }

  // Kebap/döner without "pizza" — never default to pizza kebap SKUs
  const { isKebabQuery } = require('./smartDefaults');
  if (isKebabQuery(dishName) && !norm(dishName).includes('pizza')) {
    const noPizza = items.filter(i => !norm(i.name).includes('pizza'));
    if (noPizza.length) return noPizza;
  }

  return items;
}

/** Austria: default pizza is ~33 cm; customers say Familienpizza for the large size. */
function applyPizzaSizePreference(items, dishName) {
  if (!items.length) return items;
  const pizzaItems = items.filter(i => norm(i.name).includes('pizza'));
  if (!pizzaItems.length) return items;

  if (wantsFamilienPizza(dishName)) {
    const fam = pizzaItems.filter(i => /familien/i.test(norm(i.name)));
    return fam.length ? fam : items;
  }

  const standard = pizzaItems.filter(i => !/familien/i.test(norm(i.name)));
  return standard.length ? standard : items;
}

function finishAmbiguous(rawName, items) {
  const picked = trySmartDefault(rawName, items);
  if (picked) return { type: 'unique', item: picked };
  return {
    type: 'ambiguous',
    items: items.slice(0, MAX_AMBIGUOUS_RESULTS),
    rawName,
  };
}

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
  const dishName = extractDishNameForMatch(rawName) || (rawName ?? '').trim();
  const needles = expandNeedle(dishName);
  if (!needles.length) return { type: 'none' };

  const available = menuItems.filter(i => i.available !== false);
  const dishWords = dishName.split(/\s+/).filter(w => w.length > 2).map(w => norm(w));

  // Multi-word dish names (e.g. "Döner Sandwich") — require all words on the item name
  if (dishWords.length >= 2) {
    const wordHits = filterCandidatesForQuery(available.filter(item => {
      const n = norm(item.name);
      return dishWords.every(w => wordMatchesInText(w, n));
    }), dishName);
    if (wordHits.length === 1) return { type: 'unique', item: wordHits[0] };
    if (wordHits.length > 1) {
      const scored = wordHits
        .map(item => ({ item, score: scoreItemForNeedle(item, dishName) }))
        .sort((a, b) => b.score - a.score);
      if (scored.length === 1) return { type: 'unique', item: scored[0].item };
      const top = scored[0].score;
      if (scored.length > 1 && top - scored[1].score >= AMBIGUITY_SCORE_GAP) {
        return { type: 'unique', item: scored[0].item };
      }
      return finishAmbiguous(rawName, scored.slice(0, MAX_AMBIGUOUS_RESULTS).map(x => x.item));
    }
  }

  // Single-word or fallback stem match (e.g. "döner", "cola")
  const stemHits = filterCandidatesForQuery(available.filter(item => {
    const n = norm(item.name);
    return needles.some(needle =>
      n === needle || n.startsWith(`${needle} `) || n.startsWith(needle) || n.includes(` ${needle}`),
    );
  }), dishName);
  if (stemHits.length > 1) {
    return finishAmbiguous(rawName, stemHits);
  }
  if (stemHits.length === 1) return { type: 'unique', item: stemHits[0] };

  const scored = filterCandidatesForQuery(
    available
      .map(item => ({ item, score: scoreItemForNeedle(item, needles) }))
      .filter(x => x.score >= MIN_MATCH_SCORE)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item),
    dishName,
  ).map(item => ({
    item,
    score: scoreItemForNeedle(item, needles),
  })).sort((a, b) => b.score - a.score);

  if (!scored.length) return { type: 'none' };
  if (scored.length === 1) return { type: 'unique', item: scored[0].item };

  const topScore = scored[0].score;
  if (topScore - scored[1].score >= AMBIGUITY_SCORE_GAP) {
    return { type: 'unique', item: scored[0].item };
  }

  const topTier = scored.filter(x => x.score >= topScore - AMBIGUITY_SCORE_GAP);
  if (topTier.length === 1) return { type: 'unique', item: topTier[0].item };

  return finishAmbiguous(rawName, topTier.slice(0, MAX_AMBIGUOUS_RESULTS).map(x => x.item));
}

module.exports = { norm, matchMenuItem, classifyMenuMatch, scoreMatch, scoreItemForNeedle };
