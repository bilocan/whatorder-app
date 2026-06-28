// Match customer text to menu categories and return category item lists (submenus).

const { extractDishNameForMatch } = require('./intentModifiers');
const {
  scoreCategoryMatch, groupMenuByCategory, tokensOf, collapsedMenuLabel,
} = require('./menuMapper');

const MIN_CATEGORY_SCORE = 70;
const MAX_SUBMENU_ITEMS = 8;

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

/** @deprecated use scoreCategoryMatch — kept for tests */
function scoreCategoryQuery(query, categoryName, menuMatch = null) {
  return scoreCategoryMatch(query, categoryName, menuMatch);
}

/** Items in the best-matching category (or categories tied at the top score). */
function findCategorySubmenuItems(query, menuItems, menuMatch = null) {
  const dishName = extractDishNameForMatch(query) || (query ?? '').trim();
  if (!dishName) return [];

  const available = (menuItems ?? []).filter(i => i.available !== false);
  const grouped = groupMenuByCategory(available);

  let bestScore = 0;
  const bestCats = [];
  for (const cat of grouped.keys()) {
    const score = scoreCategoryMatch(dishName, cat, menuMatch);
    if (score > bestScore) {
      bestScore = score;
      bestCats.length = 0;
      bestCats.push(cat);
    } else if (score === bestScore && score > 0) {
      bestCats.push(cat);
    }
  }

  if (bestScore < MIN_CATEGORY_SCORE) return [];

  const items = [];
  for (const cat of bestCats) {
    items.push(...grouped.get(cat));
  }
  return items;
}

/**
 * True when the customer typed the category label itself (e.g. "Kebap", "Familienpizza"),
 * not a dish synonym that merely overlaps the category (e.g. "Döner", "Döner Kebab").
 */
function isBareCategoryLabel(query, categoryName, menuMatch = null) {
  const dishName = extractDishNameForMatch(query) || (query ?? '').trim();
  if (!dishName || !categoryName) return false;
  if (scoreCategoryMatch(dishName, categoryName, menuMatch) >= 100) return true;
  const qTokens = tokensOf(dishName);
  const cTokens = tokensOf(categoryName);
  if (qTokens.length && qTokens.join(' ') === cTokens.join(' ')) return true;
  return collapsedMenuLabel(dishName) === collapsedMenuLabel(categoryName);
}

/** True when query names a category, not a specific item SKU. */
function isCategorySubmenuQuery(query, candidates, menuMatch = null) {
  const dishName = extractDishNameForMatch(query) || (query ?? '').trim();
  const list = candidates ?? [];
  if (!dishName || !list.length) return false;

  const cats = [...new Set(list.map(i => i.category || 'other'))];
  if (cats.length !== 1) return false;

  if (scoreCategoryMatch(dishName, cats[0], menuMatch) < MIN_CATEGORY_SCORE) return false;
  if (!isBareCategoryLabel(dishName, cats[0], menuMatch)) return false;
  return !list.some(i => norm(i.name) === norm(dishName));
}

function tryCategorySubmenu(rawName, menuItems, menuMatch = null) {
  const items = findCategorySubmenuItems(rawName, menuItems, menuMatch);
  if (!items.length) return null;
  if (items.length === 1) return { type: 'unique', item: items[0] };
  return {
    type: 'ambiguous',
    items: items.slice(0, MAX_SUBMENU_ITEMS),
    rawName,
  };
}

module.exports = {
  MIN_CATEGORY_SCORE,
  scoreCategoryQuery,
  findCategorySubmenuItems,
  isCategorySubmenuQuery,
  isBareCategoryLabel,
  tryCategorySubmenu,
  groupMenuByCategory,
};
