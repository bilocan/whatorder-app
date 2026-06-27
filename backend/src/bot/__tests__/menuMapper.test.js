const {
  scoreCategoryMatch,
  normalizeMenuLabel,
  collapsedMenuLabel,
  buildMenuMatchIndex,
  suggestCategoryAliases,
} = require('../menuMapper');
const { findCategorySubmenuItems } = require('../menuCategory');

const ENES_FAMILIEN_MENU = [
  { id: 'f1', name: 'Pizza Margherita (50cm)', price: 18, category: 'Familien-Pizza 50cm', available: true },
  { id: 'f2', name: 'Pizza Salami (50cm)', price: 19, category: 'Familien-Pizza 50cm', available: true },
  { id: 'p1', name: 'Pizza Margherita (33cm)', price: 10, category: 'Pizza 33cm', available: true },
];

describe('menuMapper', () => {
  test('normalizeMenuLabel strips hyphen and cm size', () => {
    expect(normalizeMenuLabel('Familien-Pizza 50cm')).toBe('familien pizza');
    expect(collapsedMenuLabel('Familien-Pizza 50cm')).toBe('familienpizza');
  });

  test('scoreCategoryMatch links Familienpizza to Familien-Pizza 50cm', () => {
    expect(scoreCategoryMatch('Familienpizza', 'Familien-Pizza 50cm')).toBeGreaterThanOrEqual(70);
    expect(scoreCategoryMatch('familien pizza', 'Familien-Pizza 50cm')).toBeGreaterThanOrEqual(70);
  });

  test('scoreCategoryMatch tolerates familienpizza typo', () => {
    expect(scoreCategoryMatch('familienpizza', 'Familien-Pizza 50cm')).toBeGreaterThanOrEqual(70);
  });

  test('scoreCategoryMatch does not map Familienpizza to Pizza 33cm', () => {
    expect(scoreCategoryMatch('Familienpizza', 'Pizza 33cm')).toBeLessThan(70);
  });

  test('manual alias on menuMatch index', () => {
    const menuMatch = {
      categories: {
        'Familien-Pizza 50cm': {
          aliases: ['familenpizza'],
        },
      },
    };
    expect(scoreCategoryMatch('familenpizza', 'Familien-Pizza 50cm', menuMatch)).toBeGreaterThanOrEqual(70);
  });

  test('buildMenuMatchIndex suggests collapsed category aliases', () => {
    const index = buildMenuMatchIndex(ENES_FAMILIEN_MENU);
    const fam = index.categories['Familien-Pizza 50cm'];
    expect(fam.normalized).toBe('familien pizza');
    expect(fam.aliases).toContain('familienpizza');
    expect(fam.itemCount).toBe(2);
  });

  test('suggestCategoryAliases includes synonym terms', () => {
    const aliases = suggestCategoryAliases('Familien-Pizza 50cm');
    expect(aliases.some(a => a.includes('familien'))).toBe(true);
  });
});

describe('menuCategory with menuMapper scoring', () => {
  test('Familienpizza opens Enes familien category submenu', () => {
    const items = findCategorySubmenuItems('Familienpizza', ENES_FAMILIEN_MENU);
    expect(items).toHaveLength(2);
    expect(items.every(i => i.category === 'Familien-Pizza 50cm')).toBe(true);
  });

  test('typo familienpizza still opens familien submenu', () => {
    const items = findCategorySubmenuItems('familienpizza', ENES_FAMILIEN_MENU);
    expect(items).toHaveLength(2);
  });
});
