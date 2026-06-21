const {
  MAX_LIST_ROWS,
  ITEMS_PER_PAGE,
  encodeCategory,
  decodeCategory,
  groupMenuByCategory,
  buildFlatSections,
  buildCategorySections,
  buildItemPageSections,
  shouldUseCategoryPicker,
} = require('../botHelpers');

const menu = [
  { id: '1', name: 'Item 1', price: 5, category: 'mains' },
  { id: '2', name: 'Item 2', price: 6, category: 'mains' },
  { id: '3', name: 'Item 3', price: 7, category: 'drinks' },
];

describe('encodeCategory / decodeCategory', () => {
  test('round-trips unicode category names', () => {
    const cat = 'Food & Beverages > Döner';
    expect(decodeCategory(encodeCategory(cat))).toBe(cat);
  });
});

describe('buildFlatSections', () => {
  test('includes all items when count is within WhatsApp limit', () => {
    const sections = buildFlatSections(menu, 'en');
    const rows = sections.flatMap(s => s.rows);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe('item_1');
  });
});

describe('shouldUseCategoryPicker', () => {
  test('returns false for small menus', () => {
    expect(shouldUseCategoryPicker(menu)).toBe(false);
  });

  test('returns true when menu exceeds list row limit', () => {
    const big = Array.from({ length: 11 }, (_, i) => ({
      id: String(i),
      name: `Item ${i}`,
      price: 1,
      category: 'mains',
    }));
    expect(shouldUseCategoryPicker(big)).toBe(false);
  });

  test('returns true when menu exceeds list row limit across categories', () => {
    const big = Array.from({ length: 11 }, (_, i) => ({
      id: String(i),
      name: `Item ${i}`,
      price: 1,
      category: i < 6 ? 'mains' : 'drinks',
    }));
    expect(shouldUseCategoryPicker(big)).toBe(true);
  });
});

describe('buildCategorySections', () => {
  test('lists each category with item count', () => {
    const sections = buildCategorySections(menu, 'en');
    expect(sections[0].rows).toHaveLength(2);
    expect(sections[0].rows[0].id).toBe(`cat_${encodeCategory('mains')}`);
  });
});

describe('buildItemPageSections', () => {
  test('paginates large categories with next and back rows', () => {
    const big = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Dish ${i}`,
      price: 9.5,
      category: 'mains',
    }));
    const sections = buildItemPageSections(big, 'en', { category: 'mains', page: 0, multiCategory: true });
    const rows = sections[0].rows;
    expect(rows.length).toBeLessThanOrEqual(MAX_LIST_ROWS);
    expect(rows.filter(r => r.id.startsWith('item_'))).toHaveLength(ITEMS_PER_PAGE);
    expect(rows.some(r => r.id === 'nav_cats')).toBe(true);
    expect(rows.some(r => r.id.startsWith('navp_'))).toBe(true);
  });

  test('second page includes previous navigation', () => {
    const big = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Dish ${i}`,
      price: 9.5,
      category: 'mains',
    }));
    const sections = buildItemPageSections(big, 'en', { category: 'mains', page: 1, multiCategory: false });
    const rows = sections[0].rows;
    expect(rows.some(r => r.id === `navp_${encodeCategory('mains')}_0`)).toBe(true);
  });
});
