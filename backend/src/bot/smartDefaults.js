const { containsWord, splitCompoundDish, wordMatchesInText, expandNeedle } = require('./menuSynonyms');
const { extractDishNameForMatch } = require('./intentModifiers');

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

const DRINK_STEMS = [
  'cola', 'kola', 'coke', 'pepsi', 'fanta', 'sprite', 'ayran', 'ayram',
  'bier', 'beer', 'wasser', 'water', 'saft', 'eistee', 'icetea', 'ice tea', 'red bull', 'monster',
];

const KEBAB_STEMS = ['doner', 'döner', 'kebap', 'kebab', 'durum', 'dürüm', 'sandwich'];

function isDrinkStem(word) {
  const w = norm(word);
  return DRINK_STEMS.some(stem => containsWord(w, stem) || w === stem);
}

function queryExpandsToStem(query, stems) {
  const expanded = new Set(expandNeedle(query));
  return stems.some(stem => expanded.has(norm(stem)));
}

function isKebabQuery(rawName) {
  const dish = norm(extractDishNameForMatch(rawName) || rawName);
  if (dish.includes('pizza')) return false;
  if (splitCompoundDish(dish)) return true;
  if (KEBAB_STEMS.some(stem => containsWord(dish, stem) || dish === stem)) return true;
  return queryExpandsToStem(dish, KEBAB_STEMS);
}

const EXPLICIT_SIZE_RE = /\b(0[,.]33\s*l?|0[,.]5\s*l?|1[,.]?0?\s*l|33\s*cl|50\s*cl|330\s*ml|500\s*ml|0[,.]25\s*l?|liter|litre|gross|groß|large|xl|pint)\b/i;

function hasExplicitDrinkSize(text) {
  return EXPLICIT_SIZE_RE.test(norm(text ?? ''));
}

function pickMarkedDefault(candidates) {
  const marked = (candidates ?? []).filter(c => c.defaultVariant === true || c.isDefault === true);
  if (marked.length === 1) return marked[0];
  return null;
}

/**
 * When several menu rows match, pick a sensible default so the customer can confirm
 * and correct in the proposal — instead of stopping for a pick list.
 * Returns one item or null (caller should show disambiguation).
 */
function shouldApplyKebabDefault(rawName, candidates) {
  const dish = norm(extractDishNameForMatch(rawName) || rawName);
  if (dish.includes('pizza')) return false;
  if (splitCompoundDish(dish)) return true;
  const words = dish.split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 2) return true;
  if (/sandwich/i.test(dish)) return true;
  return (candidates ?? []).some(c => /sandwich/i.test(norm(c.name)));
}

const PIZZA_GENERIC_WORDS = new Set([
  'pizza', 'familienpizza', 'familien', 'grosse', 'grose', 'große', 'family',
]);

/** Do not default to cheapest pizza when the customer named a variant that matched nothing. */
function hasUnmatchedVariantWord(rawName, candidates) {
  const dish = norm(extractDishNameForMatch(rawName) || rawName);
  const words = dish.split(/\s+/).filter(w => w.length > 2 && !PIZZA_GENERIC_WORDS.has(w));
  if (!words.length) return false;
  return words.some(v =>
    !(candidates ?? []).some(c => wordMatchesInText(v, norm(c.name))),
  );
}

function pickPizzaVariantDefault(candidates) {
  const list = (candidates ?? []).filter(c => norm(c.name).includes('pizza'));
  if (!list.length) return null;
  const standard = list.filter(c => !/familien/i.test(norm(c.name)));
  if (standard.length === 1) return standard[0];
  if (standard.length > 1) {
    return [...standard].sort((a, b) => Number(a.price) - Number(b.price))[0];
  }
  return list.length === 1 ? list[0] : null;
}

function pickKebabDefault(candidates, rawName) {
  const dish = norm(extractDishNameForMatch(rawName) || rawName);
  const list = (candidates ?? []).filter(c => !norm(c.name).includes('pizza'));
  if (!list.length) return null;

  // Dürüm / Special only when the customer said so
  if (/durum|dürüm|special/i.test(dish)) {
    const durum = list.filter(c => /durum|dürüm|special/i.test(norm(c.name)));
    if (durum.length === 1) return durum[0];
    if (durum.length > 1) {
      return [...durum].sort((a, b) => Number(a.price) - Number(b.price))[0];
    }
    return null;
  }

  const sandwich = list.filter(c => /sandwich/i.test(norm(c.name)));
  if (sandwich.length === 1) return sandwich[0];
  if (sandwich.length > 1) {
    return [...sandwich].sort((a, b) => Number(a.price) - Number(b.price))[0];
  }

  return null;
}

const STEM_DEFAULT_EXCLUSIONS = {
  kebap: ['durum', 'dürüm', 'special', 'box', 'falafel', 'pizza'],
  kebab: ['durum', 'dürüm', 'special', 'box', 'falafel', 'pizza'],
  doner: ['box', 'pizza', 'durum', 'dürüm', 'special', 'falafel'],
  döner: ['box', 'pizza', 'durum', 'dürüm', 'special', 'falafel'],
};

function dishConflictsWithStemDefault(dish, stem) {
  const exclusions = STEM_DEFAULT_EXCLUSIONS[norm(stem)] ?? [];
  return exclusions.some(v => containsWord(dish, v));
}

function pickOwnerStemDefault(rawName, candidates, menuMatch) {
  const stemDefaults = menuMatch?.defaults?.stemDefaults;
  if (!stemDefaults || typeof stemDefaults !== 'object') return null;

  const dish = norm(extractDishNameForMatch(rawName) || rawName);
  const expanded = new Set(expandNeedle(dish));
  expanded.add(dish);

  for (const [stem, itemId] of Object.entries(stemDefaults)) {
    if (!itemId) continue;
    const stemNorm = norm(stem);
    if (dishConflictsWithStemDefault(dish, stem)) continue;
    const matches = expanded.has(stemNorm)
      || dish === stemNorm
      || containsWord(dish, stemNorm);
    if (!matches) continue;
    const found = (candidates ?? []).find(c => c.id === itemId);
    if (found) return found;
  }
  return null;
}

function trySmartDefault(rawName, candidates, menuMatch = null) {
  const list = (candidates ?? []).filter(c => c?.id && c?.name);
  if (list.length <= 1) return list[0] ?? null;

  const marked = pickMarkedDefault(list);
  if (marked) return marked;

  const ownerStem = pickOwnerStemDefault(rawName, list, menuMatch);
  if (ownerStem) return ownerStem;

  if (isKebabQuery(rawName) && shouldApplyKebabDefault(rawName, list)) {
    return pickKebabDefault(list, rawName);
  }

  if (list.every(c => norm(c.name).includes('pizza'))) {
    if (hasUnmatchedVariantWord(rawName, list)) return null;
    return pickPizzaVariantDefault(list);
  }

  return null;
}

module.exports = {
  trySmartDefault,
  pickOwnerStemDefault,
  isDrinkStem,
  isKebabQuery,
  hasExplicitDrinkSize,
  PIZZA_GENERIC_WORDS,
};
