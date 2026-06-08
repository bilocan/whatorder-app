// Use factory mocks so the real modules (and firebase init) are never loaded.
jest.mock('../../lib/collections', () => ({
  menuRef: jest.fn(),
  businessRef: jest.fn(),
}));
jest.mock('../templates');

const { getMenu, getBusinessInfo, formatMenuText, matchMenuItem } = require('../menuService');
const { menuRef, businessRef } = require('../../lib/collections');
const { t } = require('../templates');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// matchMenuItem — pure function, no mocks needed
// ---------------------------------------------------------------------------
describe('matchMenuItem', () => {
  const MENU = [
    { id: '1', name: 'Döner', price: 8.5 },
    { id: '2', name: 'Döner Box', price: 11.0 },
    { id: '3', name: 'Lahmacun', price: 7.0 },
    { id: '4', name: 'Ayran', price: 2.0 },
  ];

  test('exact match (case-insensitive)', () => {
    expect(matchMenuItem('döner', MENU)).toEqual(MENU[0]);
    expect(matchMenuItem('DÖNER', MENU)).toEqual(MENU[0]);
    expect(matchMenuItem('Döner', MENU)).toEqual(MENU[0]);
  });

  test('prefers exact over partial match', () => {
    // "Döner" should win over "Döner Box"
    expect(matchMenuItem('Döner', MENU)).toEqual(MENU[0]);
  });

  test('diacritic-insensitive: "doner" matches "Döner"', () => {
    expect(matchMenuItem('doner', MENU)).toEqual(MENU[0]);
  });

  test('partial match: query is substring of menu name', () => {
    expect(matchMenuItem('lahma', MENU)).toEqual(MENU[2]);
  });

  test('partial match: menu name is substring of query', () => {
    expect(matchMenuItem('fresh Ayran drink please', MENU)).toEqual(MENU[3]);
  });

  test('returns undefined when nothing matches', () => {
    expect(matchMenuItem('pizza', MENU)).toBeUndefined();
    expect(matchMenuItem('burger', MENU)).toBeUndefined();
  });

  test('Turkish dotless-i: "ıstanbul" normalises to same as "istanbul"', () => {
    const items = [{ id: 'x', name: 'Istanbul Special', price: 10 }];
    expect(matchMenuItem('ıstanbul special', items)).toEqual(items[0]);
  });

  test('handles empty menu', () => {
    expect(matchMenuItem('döner', [])).toBeUndefined();
  });

  test('trims whitespace before comparing', () => {
    expect(matchMenuItem('  Ayran  ', MENU)).toEqual(MENU[3]);
  });
});

// ---------------------------------------------------------------------------
// getMenu — wraps Firestore
// ---------------------------------------------------------------------------
describe('getMenu', () => {
  test('returns mapped docs from available items query', async () => {
    const docs = [
      { id: 'item_1', data: () => ({ name: 'Döner', price: 8.5, available: true }) },
      { id: 'item_2', data: () => ({ name: 'Ayran', price: 2.0, available: true }) },
    ];
    menuRef.mockReturnValue({
      where: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs }) }),
    });

    const result = await getMenu('biz_1');
    expect(result).toEqual([
      { id: 'item_1', name: 'Döner', price: 8.5, available: true },
      { id: 'item_2', name: 'Ayran', price: 2.0, available: true },
    ]);
  });

  test('returns empty array when no items', async () => {
    menuRef.mockReturnValue({
      where: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs: [] }) }),
    });

    const result = await getMenu('biz_1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBusinessInfo — wraps Firestore
// ---------------------------------------------------------------------------
describe('getBusinessInfo', () => {
  test('returns business data when document exists', async () => {
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Döner Palace', avgPrepTime: 20 }),
      }),
    });

    const result = await getBusinessInfo('biz_1');
    expect(result).toEqual({ name: 'Döner Palace', avgPrepTime: 20 });
  });

  test('returns defaults when document does not exist', async () => {
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });

    const result = await getBusinessInfo('biz_1');
    expect(result).toEqual({ name: 'Restaurant', avgPrepTime: 30 });
  });
});

// ---------------------------------------------------------------------------
// formatMenuText
// ---------------------------------------------------------------------------
describe('formatMenuText', () => {
  test('returns menuEmpty message when items array is empty', () => {
    t.mockReturnValue('No items available right now.');

    const result = formatMenuText([], 'en');

    expect(t).toHaveBeenCalledWith('menuEmpty', 'en');
    expect(result).toBe('No items available right now.');
  });

  test('formats each item with name and price (2 decimal places)', () => {
    t.mockImplementation((key) => {
      if (key === 'menuHeader') return 'HEADER';
      if (key === 'menuExample') return 'EXAMPLE';
      return key;
    });

    const items = [
      { name: 'Döner', price: 8.5 },
      { name: 'Ayran', price: 2 },
    ];
    const result = formatMenuText(items, 'en');

    expect(result).toContain('Döner');
    expect(result).toContain('€8.50');
    expect(result).toContain('Ayran');
    expect(result).toContain('€2.00');
    expect(result).toContain('HEADER');
    expect(result).toContain('EXAMPLE');
  });

  test('uses default lang "tr" when not specified', () => {
    t.mockReturnValue('');
    const items = [{ name: 'Döner', price: 8.5 }];
    formatMenuText(items);

    expect(t).toHaveBeenCalledWith('menuHeader', 'tr');
  });
});
