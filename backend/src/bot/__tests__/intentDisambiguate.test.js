const { resolveCandidateFromText, hydrateDisambiguation, mergePendingLine } = require('../intentDisambiguate');
const { getMenu } = require('../menuService');

jest.mock('../menuService');

const CANDIDATES = [
  { id: 'cola_033', name: 'Coca Cola 0.33L', price: 2.9 },
  { id: 'cola_05', name: 'Coca Cola 0.5L', price: 3.5 },
];

describe('resolveCandidateFromText', () => {
  test('matches name with price suffix stripped', () => {
    expect(resolveCandidateFromText('Coca Cola 0.33L €2.90', CANDIDATES)).toEqual(CANDIDATES[0]);
  });

  test('matches partial name', () => {
    expect(resolveCandidateFromText('coca cola 0.5l', CANDIDATES)).toEqual(CANDIDATES[1]);
  });

  test('returns null when no match', () => {
    expect(resolveCandidateFromText('fanta', CANDIDATES)).toBeNull();
  });
});

describe('mergePendingLine', () => {
  test('merges qty for same menu item', () => {
    const result = mergePendingLine(
      [{ menuItemId: 'd1', name: 'Adana', qty: 1, price: 9.5 }],
      { menuItemId: 'd1', name: 'Adana', qty: 1, price: 9.5 },
    );
    expect(result).toEqual([{ menuItemId: 'd1', name: 'Adana', qty: 2, price: 9.5 }]);
  });
});

describe('hydrateDisambiguation', () => {
  beforeEach(() => {
    getMenu.mockResolvedValue(CANDIDATES);
  });

  test('rebuilds candidates when session snapshot lost ids', async () => {
    const broken = {
      rawName: 'cola',
      qty: 1,
      candidates: [{ name: 'Coca Cola 0.33L', price: 2.9 }],
    };
    const hydrated = await hydrateDisambiguation(broken, 'biz_test');
    expect(hydrated.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'cola_033' }),
    ]));
  });
});
