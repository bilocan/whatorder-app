const {
  scoreCategoryQuery,
  findCategorySubmenuItems,
  tryCategorySubmenu,
  isCategorySubmenuQuery,
} = require('../menuCategory');
const { classifyMenuMatch } = require('../menuMatch');
const { parseIntent } = require('../intentParser');
const { matchIntentToMenu } = require('../intentMatcher');
const { rankMenuItems } = require('../menuSearch');

const KEBAP_MENU = [
  { id: 'k1', name: 'Adana Kebap', price: 9.5, category: 'Kebap', available: true },
  { id: 'k2', name: 'Urfa Kebap', price: 9.5, category: 'Kebap', available: true },
  { id: 'p1', name: 'Pizza Margherita', price: 10, category: 'Pizza', available: true },
];

const FAMILIEN_CATEGORY_MENU = [
  { id: 'f1', name: 'Margherita', price: 18, category: 'Familienpizza', available: true },
  { id: 'f2', name: 'Salami', price: 19, category: 'Familienpizza', available: true },
  { id: 'p1', name: 'Margherita', price: 10, category: 'Pizza', available: true },
];

describe('menuCategory', () => {
  test('scoreCategoryQuery exact match', () => {
    expect(scoreCategoryQuery('Kebap', 'Kebap')).toBe(100);
    expect(scoreCategoryQuery('Familienpizza', 'Familienpizza')).toBe(100);
  });

  test('findCategorySubmenuItems returns category rows', () => {
    const items = findCategorySubmenuItems('Kebap', KEBAP_MENU);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.category === 'Kebap')).toBe(true);
  });

  test('Familienpizza category lists items without familien in name', () => {
    const items = findCategorySubmenuItems('Familienpizza', FAMILIEN_CATEGORY_MENU);
    expect(items).toHaveLength(2);
    expect(items.map(i => i.name)).toEqual(['Margherita', 'Salami']);
  });

  test('tryCategorySubmenu ambiguous for multiple items', () => {
    const result = tryCategorySubmenu('Familienpizza', FAMILIEN_CATEGORY_MENU);
    expect(result.type).toBe('ambiguous');
    expect(result.items).toHaveLength(2);
  });

  test('isCategorySubmenuQuery true when query names category not SKU', () => {
    expect(isCategorySubmenuQuery('Familienpizza', FAMILIEN_CATEGORY_MENU.slice(0, 2))).toBe(true);
    expect(isCategorySubmenuQuery('Margherita', [FAMILIEN_CATEGORY_MENU[0]])).toBe(false);
  });
});

describe('classifyMenuMatch — category submenu', () => {
  test('Kebap alone lists kebap category', () => {
    const result = classifyMenuMatch('Kebap', KEBAP_MENU);
    expect(result.type).toBe('ambiguous');
    expect(result.items.every(i => i.category === 'Kebap')).toBe(true);
  });

  test('10 Familienpizza disambiguates via category', () => {
    const intent = parseIntent('10 Familienpizza');
    const { matched, disambiguation } = matchIntentToMenu(intent, FAMILIEN_CATEGORY_MENU);
    expect(matched).toHaveLength(0);
    expect(disambiguation).not.toBeNull();
    expect(disambiguation.qty).toBe(10);
    expect(disambiguation.candidates).toHaveLength(2);
  });

  test('rankMenuItems returns category submenu', () => {
    const results = rankMenuItems('Familienpizza', FAMILIEN_CATEGORY_MENU);
    expect(results).toHaveLength(2);
  });
});
