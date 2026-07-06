// Pure menu matching helpers (no Firestore). Used by menuService and intentMatcher.

const { expandNeedle, wordMatchesInText, splitCompoundDish, nameTokens, typoTolerantWordMatch, scoreStemTypo, MIN_FUZZY_SYNONYM_SCORE, SYNONYM_GROUPS } = require('./menuSynonyms');
const { extractDishNameForMatch } = require('./intentModifiers');
const { trySmartDefault, hasExplicitDrinkSize } = require('./smartDefaults');
const { tryCategorySubmenu, isCategorySubmenuQuery } = require('./menuCategory');
const { findTokenIndexMatches } = require('./menuTokenIndex');
const { tokensOf } = require('./menuMapper');
const { norm } = require('../lib/textNorm');

const FAMILIEN_MARKER_RE = /\b(familien|family)\b/i;
const GROSSE_MARKER_RE = /\b(gro[sß]e|large|xl)\b/i;
const LARGE_CM_RE = /\b(4[5-9]|5\d|60)\s*cm\b/i;

function scoreMatch(needle, candidate) {
  if (!candidate) return 0;
  if (needle === candidate) return 100;
  const wordRe = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (wordRe.test(needle)) return 80;
  if (candidate.startsWith(needle) || needle.startsWith(candidate)) return 50;
  if (candidate.includes(needle) || needle.includes(candidate)) return 10;
  if (!needle.includes(' ')) {
    const fullStem = scoreStemTypo(needle, candidate);
    if (fullStem >= MIN_FUZZY_SYNONYM_SCORE) return fullStem;
    let bestToken = 0;
    for (const token of nameTokens(candidate)) {
      bestToken = Math.max(bestToken, scoreStemTypo(needle, token));
    }
    if (bestToken >= MIN_FUZZY_SYNONYM_SCORE) return bestToken;
    if (nameTokens(candidate).some(t => typoTolerantWordMatch(needle, t))) return 75;
  }
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

function itemMatchLabels(item) {
  return [...new Set([item.name, ...(item.aliases ?? [])].filter(Boolean))];
}

/** Exact SKU when the customer named a specific item, not a bare stem like "döner" or "cola". */
function shouldPreferExactSkuMatch(dishName) {
  const words = String(dishName ?? '').split(/\s+/).filter(w => w.length >= 2);
  return words.length >= 2 || hasExplicitDrinkSize(dishName);
}
function findExactMenuItem(dishName, menuItems) {
  const target = norm(dishName);
  if (!target) return null;
  for (const item of menuItems ?? []) {
    if (item.available === false) continue;
    if (norm(item.name) === target) return item;
    for (const alias of item.aliases ?? []) {
      if (norm(alias) === target) return item;
    }
  }
  return null;
}

function labelStemMatchesNeedle(needle, label) {
  const n = norm(label);
  const tokens = nameTokens(n);
  return n === needle
    || n.startsWith(`${needle} `)
    || n.startsWith(needle)
    || n.includes(` ${needle}`)
    || (!needle.includes(' ') && tokens.some(t => typoTolerantWordMatch(needle, t)));
}

function itemStemMatchesNeedles(item, needles) {
  return itemMatchLabels(item).some(label => (
    needles.some(needle => labelStemMatchesNeedle(needle, label))
  ));
}

/** Multi-word dish queries must not stem-match on single synonym needles (e.g. "pommes"). */
function substantiveWordCount(dishName) {
  return String(dishName ?? '')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !/^(mit|und|and|ve)$/i.test(w))
    .length;
}

function needlesForStemMatch(needles, dishName) {
  const primary = norm(dishName);
  if (substantiveWordCount(dishName) < 2) return needles;

  const dishTokens = new Set(
    primary.split(/\s+/).filter(w => w.length >= 2 && !/^(mit|und|and|ve)$/i.test(w)),
  );

  return needles.filter((needle) => {
    if (needle === primary || needle.includes(' ')) return true;
    if (dishTokens.has(needle)) return true;

    for (const group of SYNONYM_GROUPS) {
      const normalized = group.map(term => norm(term));
      if (!normalized.includes(needle)) continue;
      const groupTouchesDish = normalized.some(term => (
        dishTokens.has(term)
        || [...dishTokens].some(t => term.includes(t) || t.includes(term))
      ));
      return groupTouchesDish;
    }

    return true;
  });
}

function wantsFamilienPizza(dishName) {
  const n = norm(dishName);
  return n.includes('familienpizza') || n.includes('familien pizza')
    || n.includes('grosse pizza') || n.includes('große pizza') || n.includes('family pizza');
}

function isFamilienMenuItem(item) {
  const n = norm(item.name);
  const cat = norm(item.category ?? '');
  if (FAMILIEN_MARKER_RE.test(n) || FAMILIEN_MARKER_RE.test(cat)) return true;
  if (GROSSE_MARKER_RE.test(n)) return true;
  if (LARGE_CM_RE.test(n)) return true;
  return false;
}

function isPizzaMenuItem(item) {
  const n = norm(item.name);
  const cat = norm(item.category ?? '');
  return n.includes('pizza') || FAMILIEN_MARKER_RE.test(n) || FAMILIEN_MARKER_RE.test(cat);
}

/** Only narrow to pizza SKUs when the customer actually ordered pizza. */
function isPizzaQuery(dishName) {
  const n = norm(dishName);
  return n.includes('pizza') || n.includes('familienpizza') || n.includes('familien pizza')
    || n.includes('grosse pizza') || n.includes('große pizza') || n.includes('family pizza');
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
  const pizzaItems = items.filter(isPizzaMenuItem);
  if (!pizzaItems.length) return items;

  if (wantsFamilienPizza(dishName)) {
    const fam = pizzaItems.filter(isFamilienMenuItem);
    return fam.length ? fam : items;
  }

  const standard = pizzaItems.filter(i => !isFamilienMenuItem(i));
  return standard.length ? standard : items;
}

function finishAmbiguous(rawName, items, menuMatch = null) {
  if (!isCategorySubmenuQuery(rawName, items, menuMatch)) {
    const picked = trySmartDefault(rawName, items);
    if (picked) return { type: 'unique', item: picked };
  }
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
function classifyMenuMatch(rawName, menuItems, menuMatch = null, menuTokenIndex = null) {
  const dishName = extractDishNameForMatch(rawName) || (rawName ?? '').trim();
  const needles = expandNeedle(dishName);
  if (!needles.length) return { type: 'none' };

  const available = menuItems.filter(i => i.available !== false);

  if (shouldPreferExactSkuMatch(dishName)) {
    const exact = findExactMenuItem(dishName, available);
    if (exact) return { type: 'unique', item: exact };
  }

  const queryTokens = tokensOf(dishName).filter(t => t.length >= 2);
  const tokenHits = queryTokens.length >= 2
    ? findTokenIndexMatches(rawName, menuTokenIndex, available)
    : [];
  if (tokenHits.length === 1) {
    return { type: 'unique', item: tokenHits[0].item };
  }
  if (tokenHits.length > 1 && !isCategorySubmenuQuery(rawName, tokenHits.map(h => h.item), menuMatch)) {
    const gap = tokenHits.length > 1 ? tokenHits[0].score - tokenHits[1].score : 999;
    if (gap >= 6) return { type: 'unique', item: tokenHits[0].item };
    return finishAmbiguous(rawName, tokenHits.map(h => h.item), menuMatch);
  }
  let dishWords = dishName.split(/\s+/).filter(w => w.length > 2).map(w => norm(w));
  if (dishWords.length < 2) {
    const compound = splitCompoundDish(dishWords[0] ?? dishName);
    if (compound) dishWords = compound;
  }

  // Multi-word dish names (e.g. "Döner Sandwich") — require all words on the item name
  if (dishWords.length >= 2) {
    const wordHits = filterCandidatesForQuery(available.filter(item => (
      itemMatchLabels(item).some(label => {
        const n = norm(label);
        return dishWords.every(w => wordMatchesInText(w, n));
      })
    )), dishName);
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
      return finishAmbiguous(rawName, scored.slice(0, MAX_AMBIGUOUS_RESULTS).map(x => x.item), menuMatch);
    }
  }

  // Single-word or fallback stem match (e.g. "döner", "cola")
  const stemNeedles = needlesForStemMatch(needles, dishName);
  const stemHits = filterCandidatesForQuery(available.filter(item => (
    itemStemMatchesNeedles(item, stemNeedles)
  )), dishName);
  if (stemHits.length > 1) {
    return finishAmbiguous(rawName, stemHits, menuMatch);
  }
  if (stemHits.length === 1) return { type: 'unique', item: stemHits[0] };

  // Category submenu before fuzzy name scoring (e.g. "Familienpizza" → category rows, not every pizza SKU)
  const categoryMatch = tryCategorySubmenu(rawName, available, menuMatch);
  if (categoryMatch) return categoryMatch;

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

  return finishAmbiguous(rawName, topTier.slice(0, MAX_AMBIGUOUS_RESULTS).map(x => x.item), menuMatch);
}

module.exports = {
  norm,
  matchMenuItem,
  classifyMenuMatch,
  findExactMenuItem,
  scoreMatch,
  scoreItemForNeedle,
  isFamilienMenuItem,
};
