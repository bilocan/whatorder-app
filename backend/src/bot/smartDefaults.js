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

const STANDARD_DRINK_SIZE_RE = /\b(0[,.]33|33\s*cl|330\s*ml)\b/i;

function hasExplicitDrinkSize(text) {
  return EXPLICIT_SIZE_RE.test(norm(text ?? ''));
}

function isDrinkQuery(rawName, candidates) {
  const dish = norm(extractDishNameForMatch(rawName) || rawName);
  if (DRINK_STEMS.some(stem => containsWord(dish, stem) || dish === stem)) return true;
  if (queryExpandsToStem(dish, DRINK_STEMS)) return true;
  if (!candidates?.length) return false;
  return candidates.every(c => {
    const cat = norm(c.category ?? '');
    return cat === 'drinks' || cat === 'getranke' || cat === 'getränke' || cat === 'icecek' || cat === 'içecek';
  });
}

/** Parse approximate volume in litres from an item name (for tie-breaking). */
function parseVolumeLitres(name) {
  const n = norm(name);
  const ml = n.match(/\b(\d{2,4})\s*ml\b/);
  if (ml) return parseInt(ml[1], 10) / 1000;
  const cl = n.match(/\b(\d{2,3})\s*cl\b/);
  if (cl) return parseInt(cl[1], 10) / 100;
  const dec = n.match(/\b0[,.](\d{2})\s*l?\b/);
  if (dec) return parseInt(dec[1], 10) / 100;
  const oneL = n.match(/\b1[,.]?0?\s*l\b/);
  if (oneL) return 1;
  return null;
}

function pickMarkedDefault(candidates) {
  const marked = (candidates ?? []).filter(c => c.defaultVariant === true || c.isDefault === true);
  if (marked.length === 1) return marked[0];
  return null;
}

function pickStandardDrinkSize(candidates, rawName) {
  const list = candidates ?? [];
  if (!list.length) return null;

  if (hasExplicitDrinkSize(rawName)) {
    const dish = norm(extractDishNameForMatch(rawName) || rawName);
    const sized = list.filter(c => {
      const n = norm(c.name);
      if (/0[,.]33|33\s*cl|330\s*ml/.test(dish) && STANDARD_DRINK_SIZE_RE.test(n)) return true;
      if (/0[,.]5|50\s*cl|500\s*ml/.test(dish) && /0[,.]5|50\s*cl|500\s*ml/.test(n)) return true;
      if (/1[,.]?0?\s*l/.test(dish) && /1[,.]?0?\s*l/.test(n)) return true;
      return false;
    });
    if (sized.length === 1) return sized[0];
    if (sized.length > 1) return pickBySmallestVolume(sized);
    return null;
  }

  const standard = list.filter(c => STANDARD_DRINK_SIZE_RE.test(norm(c.name)));
  if (standard.length === 1) return standard[0];
  if (standard.length > 1) return pickBySmallestVolume(standard);

  return pickBySmallestVolume(list);
}

function pickBySmallestVolume(candidates) {
  const withVol = candidates
    .map(c => ({ c, vol: parseVolumeLitres(c.name) }))
    .filter(x => x.vol != null)
    .sort((a, b) => a.vol - b.vol || a.c.price - b.c.price);
  if (withVol.length) return withVol[0].c;
  return [...candidates].sort((a, b) => Number(a.price) - Number(b.price))[0];
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

function trySmartDefault(rawName, candidates) {
  const list = (candidates ?? []).filter(c => c?.id && c?.name);
  if (list.length <= 1) return list[0] ?? null;

  const marked = pickMarkedDefault(list);
  if (marked) return marked;

  if (isDrinkQuery(rawName, list)) {
    return pickStandardDrinkSize(list, rawName);
  }

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
  isDrinkQuery,
  isDrinkStem,
  isKebabQuery,
  hasExplicitDrinkSize,
  pickStandardDrinkSize,
  PIZZA_GENERIC_WORDS,
};
