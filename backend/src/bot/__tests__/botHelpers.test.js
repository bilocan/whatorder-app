jest.mock('../menuService', () => ({
  getBusinessInfo: jest.fn(),
  resolvePhotoUrl: jest.fn((url) => (url ? `resolved:${url}` : null)),
}));

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
  buildBasketText,
  formatBasketItemLabel,
  formatBasketItemBlock,
  formatBasketItemsText,
  buildPostAddBody,
  findAddedLines,
  postAddBasketButtons,
  basketViewButtons,
  removeBasketAtIndex,
  removeBasketAtIndices,
  getBusinessesInfo,
  resolveRestaurantsForPicker,
} = require('../botHelpers');
const { getBusinessInfo } = require('../menuService');

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

describe('basket formatting', () => {
  test('formatBasketItemBlock bolds name and puts price on the main line', () => {
    expect(formatBasketItemBlock({ name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 }))
      .toBe('*1× Mis Ayran 0.25L* · €2.50');
  });

  test('formatBasketItemBlock splits modifiers onto a second line', () => {
    expect(formatBasketItemBlock({
      name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce',
      qty: 1,
      price: 7.5,
    })).toBe('*1× Kebap Sandwich Huhn* · €7.50\n   Tomaten, Salad, Zwiebel, Sauce');
  });

  test('formatBasketItemLabel keeps plain text for owner-facing fallbacks', () => {
    expect(formatBasketItemLabel({
      name: 'Kebap Sandwich Huhn — Tomaten, Salad',
      qty: 1,
      price: 7.5,
      note: 'extra scharf',
    })).toBe('Kebap Sandwich Huhn (Tomaten, Salad, extra scharf)');
  });

  test('formatBasketItemsText adds spacing around detailed items only', () => {
    const text = formatBasketItemsText([
      { name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 },
      { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
      { name: 'Kebap Sandwich Huhn — Zwiebel, Sauce', qty: 1, price: 7.5 },
    ]);
    expect(text).toContain('*1. 1× Mis Ayran 0.25L* · €2.50\n*2. 1× Coca Cola 0.33L* · €2.90');
    expect(text).toContain('*3. 1× Kebap Sandwich Huhn* · €7.50\n   Tomaten, Salad');
    expect(text).toContain('\n\n*4. 1× Kebap Sandwich Huhn* · €7.50\n   Zwiebel, Sauce');
  });

  test('formatBasketItemsText shows full modifiers when a sibling is a subset variant', () => {
    const text = formatBasketItemsText([
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.5 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
    ]);
    expect(text).toContain('*1. 1× Kebap Sandwich Huhn* · €7.50\n   Tomaten, Salad, Zwiebel, Sauce');
    expect(text).toContain('*2. 1× Kebap Sandwich Huhn* · €7.50\n   Tomaten, Salad');
  });

  test('formatBasketItemsText shows diff-only when siblings differ without subset', () => {
    const text = formatBasketItemsText([
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.5 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, extra scharf', qty: 1, price: 7.5 },
    ]);
    expect(text).toContain('*1. 1× Kebap Sandwich Huhn* · €7.50\n   Zwiebel, Sauce');
    expect(text).toContain('*2. 1× Kebap Sandwich Huhn* · €7.50\n   extra scharf');
  });

  test('formatBasketItemsText merges identical lines when unnumbered', () => {
    const text = formatBasketItemsText([
      { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
      { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
    ], { numbered: false, mergeIdentical: true });
    expect(text).toBe('*2× Coca Cola 0.33L* · €5.80');
  });

  test('formatBasketItemsText keeps separate numbered lines for identical items', () => {
    const text = formatBasketItemsText([
      { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
      { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
    ]);
    expect(text).toContain('*1. 1× Coca Cola 0.33L* · €2.90');
    expect(text).toContain('*2. 1× Coca Cola 0.33L* · €2.90');
  });

  test('formatBasketItemsText does not merge lines with different notes', () => {
    const text = formatBasketItemsText([
      { name: 'Döner', qty: 1, price: 8.5 },
      { name: 'Döner', qty: 1, price: 8.5, note: 'extra scharf' },
    ], { numbered: false, mergeIdentical: true });
    expect(text).toContain('*1× Döner* · €8.50');
    expect(text).toContain('*1× Döner* · €8.50\n   extra scharf');
  });

  test('buildBasketText includes header, rule, and bold total', () => {
    const body = buildBasketText(
      [{ name: 'Döner', qty: 2, price: 8.5 }],
      'de',
    );
    expect(body).toContain('🛒 Ihre Bestellung:');
    expect(body).toContain('*1. 2× Döner* · €17.00');
    expect(body).toContain('────────────────────────');
    expect(body).toContain('*Gesamt: €17.00*');
  });

  test('buildBasketText appends special request note', () => {
    const body = buildBasketText(
      [{ name: 'Döner', qty: 1, price: 8.5 }],
      'en',
      'no onions',
    );
    expect(body).toContain('*Total: €8.50*');
    expect(body).toContain('no onions');
  });

  test('buildPostAddBody uses compact single-item copy', () => {
    const body = buildPostAddBody('de', [{ name: 'Döner', qty: 2, price: 8.5 }], { qty: 2, name: 'Döner' });
    expect(body).toContain('✅ 2× Döner hinzugefügt');
    expect(body).toContain('🛒 2 Artikel · €17.00');
    expect(body).not.toContain('Ihre Bestellung');
  });

  test('buildPostAddBody batches multiple added lines', () => {
    const basket = [
      { name: 'Döner', qty: 2, price: 8.5 },
      { name: 'Ayran', qty: 1, price: 2 },
    ];
    const body = buildPostAddBody('en', basket, {
      addedLines: [{ name: 'Döner', qty: 2, price: 8.5 }, { name: 'Ayran', qty: 1, price: 2 }],
    });
    expect(body).toContain('3 items added');
    expect(body).toContain('3 items · €19.00');
  });

  test('findAddedLines detects qty delta on merged lines', () => {
    const before = [{ name: 'Döner', qty: 1, price: 8.5 }];
    const after = [{ name: 'Döner', qty: 3, price: 8.5 }];
    expect(findAddedLines(before, after)).toEqual([{ name: 'Döner', qty: 2, price: 8.5 }]);
  });

  test('postAddBasketButtons returns add, view, confirm', () => {
    expect(postAddBasketButtons('en').map(b => b.id)).toEqual([
      'btn_add_more', 'btn_view_basket', 'btn_confirm',
    ]);
  });

  test('basketViewButtons uses remove instead of clear', () => {
    expect(basketViewButtons('de').map(b => b.id)).toEqual([
      'btn_add_more', 'btn_remove_item', 'btn_confirm',
    ]);
  });

  test('removeBasketAtIndices drops selected lines', () => {
    const basket = [
      { name: 'Döner', qty: 1, price: 8.5 },
      { name: 'Ayran', qty: 1, price: 2 },
    ];
    expect(removeBasketAtIndices(basket, [1])).toEqual([{ name: 'Ayran', qty: 1, price: 2 }]);
  });
});

describe('restaurant picker imageUrl enforcement', () => {
  beforeEach(() => {
    getBusinessInfo.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('getBusinessesInfo resolves imageUrl from business info', async () => {
    getBusinessInfo.mockResolvedValue({ name: 'Döner Palace', lat: 48.2, lng: 16.37, imageUrl: 'gs://bucket/cover.jpg' });
    const [info] = await getBusinessesInfo(['biz_a']);
    expect(info.imageUrl).toBe('resolved:gs://bucket/cover.jpg');
  });

  test('resolveRestaurantsForPicker excludes businesses without imageUrl', async () => {
    getBusinessInfo.mockImplementation(async (bid) => (
      bid === 'biz_with_image'
        ? { name: 'Has Image', lat: 48.2, lng: 16.37, imageUrl: 'https://example.com/a.jpg' }
        : { name: 'No Image', lat: 48.21, lng: 16.38 }
    ));

    const { pickList } = await resolveRestaurantsForPicker(
      ['biz_with_image', 'biz_no_image'], 48.2, 16.37, { unfiltered: true },
    );

    expect(pickList.map(b => b.id)).toEqual(['biz_with_image']);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('biz_no_image'));
  });
});
