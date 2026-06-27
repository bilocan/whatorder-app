// Match customer text to menu categories and return category item lists (submenus).

const { typoTolerantWordMatch, wordMatchesInText } = require('./menuSynonyms');
const { extractDishNameForMatch } = require('./intentModifiers');

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

function groupMenuByCategory(menuItems) {
  const grouped = new Map();
  for (const item of menuItems ?? []) {
    const cat = item.category || 'other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(item);
  }
  return grouped;
}

function scoreCategoryQuery(query, categoryName) {
  const q = norm(query);
  const c = norm(categoryName);
  if (!q || !c || c === 'other') return 0;
  if (q === c) return 100;
  if (c.startsWith(`${q} `) || q.startsWith(`${c} `)) return 85;
  if (c.startsWith(q) || q.startsWith(c)) return 80;
  if (wordMatchesInText(q, c) || wordMatchesInText(c, q)) return 75;
  if (typoTolerantWordMatch(q, c)) return 75;
  return 0;
}

/** Items in the best-matching category (or categories tied at the top score). */
function findCategorySubmenuItems(query, menuItems) {
  const dishName = extractDishNameForMatch(query) || (query ?? '').trim();
  if (!dishName) return [];

  const available = (menuItems ?? []).filter(i => i.available !== false);
  const grouped = groupMenuByCategory(available);

  let bestScore = 0;
  const bestCats = [];
  for (const cat of grouped.keys()) {
    const score = scoreCategoryQuery(dishName, cat);
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

/** True when query names a category, not a specific item SKU. */
function isCategorySubmenuQuery(query, candidates) {
  const dishName = extractDishNameForMatch(query) || (query ?? '').trim();
  const list = candidates ?? [];
  if (!dishName || !list.length) return false;

  const cats = [...new Set(list.map(i => i.category || 'other'))];
  if (cats.length !== 1) return false;

  if (scoreCategoryQuery(dishName, cats[0]) < MIN_CATEGORY_SCORE) return false;
  return !list.some(i => norm(i.name) === norm(dishName));
}

function tryCategorySubmenu(rawName, menuItems) {
  const items = findCategorySubmenuItems(rawName, menuItems);
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
  tryCategorySubmenu,
  groupMenuByCategory,
};
