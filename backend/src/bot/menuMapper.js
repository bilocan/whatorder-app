// Menu-derived category matching: normalize catalog labels, typos, and optional aliases.

const {
  typoTolerantWordMatch,
  wordMatchesInText,
  levenshtein,
  maxTypoDistance,
  SYNONYM_GROUPS,
  containsWord,
} = require('./menuSynonyms');

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

/** Strip sizes and punctuation so "Familien-Pizza 50cm" ↔ "familienpizza". */
function normalizeMenuLabel(str) {
  return norm(str)
    .replace(/-/g, ' ')
    .replace(/\b\d+\s*(?:cm|ml|cl)\b/g, ' ')
    .replace(/\b0[,.]\d+\s*l?\b/g, ' ')
    .replace(/[^\wäöüß\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapsedMenuLabel(str) {
  return normalizeMenuLabel(str).replace(/\s+/g, '');
}

function tokensOf(str) {
  return normalizeMenuLabel(str).split(/\s+/).filter(w => w.length >= 2);
}

function synonymTermsForLabel(label) {
  const n = normalizeMenuLabel(label);
  const col = collapsedMenuLabel(label);
  const terms = new Set([n, col]);
  for (const token of tokensOf(label)) terms.add(token);
  for (const group of SYNONYM_GROUPS) {
    const normalized = group.map(norm);
    if (normalized.some(term => containsWord(n, term) || col.includes(term.replace(/\s+/g, '')))) {
      normalized.forEach(term => terms.add(term));
    }
  }
  return [...terms];
}

function scoreCollapsedTypo(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (typoTolerantWordMatch(a, b)) return 78;
  const maxDist = maxTypoDistance(a, b);
  if (maxDist && levenshtein(a, b) <= maxDist) return 76;
  return 0;
}

function scoreTokenOverlap(queryTokens, categoryTokens) {
  if (!queryTokens.length || !categoryTokens.length) return 0;
  let hits = 0;
  for (const qt of queryTokens) {
    const matched = categoryTokens.some(ct => qt === ct || typoTolerantWordMatch(qt, ct));
    if (matched) hits += 1;
  }
  if (hits === queryTokens.length && hits === categoryTokens.length) return 100;
  if (hits === queryTokens.length) return 88;
  if (hits >= Math.min(queryTokens.length, categoryTokens.length)) return 82;
  return 0;
}

/**
 * Score customer text against a menu category label (+ optional manual aliases).
 * @param {object|null} menuMatch business.menuMatch from Firestore
 */
function scoreCategoryMatch(query, categoryName, menuMatch = null) {
  const q = norm(query);
  const rawCategory = String(categoryName ?? '').trim();
  const cNorm = normalizeMenuLabel(rawCategory);
  if (!q || !cNorm || cNorm === 'other') return 0;

  const qNorm = normalizeMenuLabel(query);
  const qCol = collapsedMenuLabel(query);
  const cCol = collapsedMenuLabel(rawCategory);

  if (qNorm === cNorm || qCol === cCol) return 100;
  if (cNorm.startsWith(`${qNorm} `) || qNorm.startsWith(`${cNorm} `)) return 85;
  if (cCol.startsWith(qCol) || qCol.startsWith(cCol)) return 83;

  const tokenScore = scoreTokenOverlap(tokensOf(query), tokensOf(rawCategory));
  if (tokenScore >= 82) return tokenScore;

  const collapsedScore = scoreCollapsedTypo(qCol, cCol);
  if (collapsedScore >= 76) return collapsedScore;

  if (wordMatchesInText(qNorm, cNorm) || wordMatchesInText(cNorm, qNorm)) return 75;
  if (typoTolerantWordMatch(qNorm, cNorm)) return 75;

  const manualAliases = menuMatch?.categories?.[rawCategory]?.aliases ?? [];
  for (const alias of manualAliases) {
    const aNorm = normalizeMenuLabel(alias);
    const aCol = collapsedMenuLabel(alias);
    if (qNorm === aNorm || qCol === aCol) return 100;
    if (scoreCollapsedTypo(qCol, aCol) >= 76) return 85;
    if (typoTolerantWordMatch(qCol, aCol)) return 85;
  }

  return 0;
}

function groupMenuByCategory(menuItems) {
  const grouped = new Map();
  for (const item of menuItems ?? []) {
    const cat = item.category || 'other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(item);
  }
  return grouped;
}

/** Suggested aliases for onboarding / import (not used at runtime unless persisted). */
function suggestCategoryAliases(categoryName) {
  const aliases = new Set();
  const n = normalizeMenuLabel(categoryName);
  const col = collapsedMenuLabel(categoryName);
  if (n) aliases.add(n);
  if (col && col !== n) aliases.add(col);
  for (const term of synonymTermsForLabel(categoryName)) {
    if (term.length >= 3) aliases.add(term);
  }
  aliases.delete('');
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

/** Owner default pizza category when the customer omits size (e.g. "Pizza 33cm"). */
function suggestDefaultPizzaCategory(menuItems) {
  const grouped = groupMenuByCategory(menuItems);
  const pizzaCats = [...grouped.keys()].filter((cat) => {
    if (cat === 'other') return false;
    return normalizeMenuLabel(cat).includes('pizza');
  });
  const standard = pizzaCats.filter((cat) => (
    !/\bfamilien\b/i.test(cat)
    && !/\b(4[5-9]|5\d|60)\s*cm\b/i.test(cat)
  ));
  return standard.find((cat) => /\b33\s*cm\b/i.test(cat)) ?? standard[0] ?? null;
}

/**
 * Build `businesses/{bid}.menuMatch` from live menu rows.
 * Manual aliases on the business doc are merged when rebuilding.
 */
function buildMenuMatchIndex(menuItems, existingMenuMatch = null) {
  const grouped = groupMenuByCategory(menuItems);
  const categories = {};

  for (const cat of grouped.keys()) {
    if (cat === 'other') continue;
    const suggested = suggestCategoryAliases(cat);
    const manual = existingMenuMatch?.categories?.[cat]?.aliases ?? [];
    const aliases = [...new Set([...suggested, ...manual])].sort((a, b) => a.localeCompare(b));
    categories[cat] = {
      normalized: normalizeMenuLabel(cat),
      collapsed: collapsedMenuLabel(cat),
      aliases,
      itemCount: grouped.get(cat).length,
    };
  }

  const defaults = { ...(existingMenuMatch?.defaults ?? {}) };
  if (!defaults.pizzaCategory) {
    const suggested = suggestDefaultPizzaCategory(menuItems);
    if (suggested) defaults.pizzaCategory = suggested;
  }

  return {
    version: 1,
    ...(defaults.pizzaCategory ? { defaults } : {}),
    categories,
  };
}

module.exports = {
  norm,
  normalizeMenuLabel,
  collapsedMenuLabel,
  tokensOf,
  scoreCategoryMatch,
  suggestCategoryAliases,
  suggestDefaultPizzaCategory,
  buildMenuMatchIndex,
  groupMenuByCategory,
};
