const { resolveCandidateFromText, hydrateDisambiguation, pickBestCandidate } = require('../intentDisambiguate');
const { mergePendingLine } = require('../intentMatcher');
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

describe('pickBestCandidate', () => {
  const candidates = [
    { id: '5', name: 'Döner Sandwich', price: 7.5 },
    { id: '6', name: 'Kebap Sandwich Huhn', price: 7.5 },
    { id: '1', name: 'Döner', price: 8.5 },
  ];

  test('auto-picks Döner Sandwich from mit allem phrase', () => {
    expect(pickBestCandidate('2x Döner Sandwich mit allem', candidates)?.name).toBe('Döner Sandwich');
  });
});

describe('hydrateDisambiguation', () => {
  beforeEach(() => {
    getMenu.mockResolvedValue(CANDIDATES);
  });

  test('rebuilds candidates when session snapshot lost ids', async () => {
    getMenu.mockResolvedValue([
      { id: 'd1', name: 'Döner', price: 8.5, available: true },
      { id: 'd2', name: 'Döner Box', price: 9.5, available: true },
    ]);
    const broken = {
      rawName: 'döner',
      qty: 1,
      candidates: [{ name: 'Döner', price: 8.5 }],
    };
    const hydrated = await hydrateDisambiguation(broken, 'biz_test');
    expect(hydrated.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'd1' }),
    ]));
  });
});
