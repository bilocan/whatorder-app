const {
  isShortLookupText,
  isSearchKeyword,
  rankMenuItems,
} = require('../menuSearch');

const MENU = [
  { id: '1', name: 'Döner', price: 8.5, aliases: ['doner'] },
  { id: '2', name: 'Cola', price: 2.5, aliases: ['coke', 'kola'] },
  { id: '3', name: 'Pizza Margherita', price: 12, aliases: ['pizza'] },
  { id: '4', name: 'Chicken Döner', price: 9.5 },
];

describe('isShortLookupText', () => {
  test('accepts 1–2 word queries', () => {
    expect(isShortLookupText('pizza', 'pizza')).toBe(true);
    expect(isShortLookupText('chicken döner', 'chicken döner')).toBe(true);
  });

  test('rejects greetings and order signals', () => {
    expect(isShortLookupText('hello', 'hello')).toBe(false);
    expect(isShortLookupText('2x döner', '2x döner')).toBe(false);
    expect(isShortLookupText('pizza and cola', 'pizza and cola')).toBe(false);
  });

  test('rejects menu keywords', () => {
    expect(isShortLookupText('menu', 'menu')).toBe(false);
  });
});

describe('isSearchKeyword', () => {
  test('detects search triggers', () => {
    expect(isSearchKeyword('search')).toBe(true);
    expect(isSearchKeyword('suche')).toBe(true);
    expect(isSearchKeyword('ara')).toBe(true);
  });
});

describe('rankMenuItems', () => {
  test('returns top matches by score', () => {
    const results = rankMenuItems('pizza', MENU);
    expect(results.map(i => i.name)).toEqual(['Pizza Margherita']);
  });

  test('matches via alias', () => {
    const results = rankMenuItems('kola', MENU);
    expect(results[0].name).toBe('Cola');
  });

  test('limits to five results', () => {
    const bigMenu = Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`,
      name: `Snack ${i}`,
      price: 3,
      aliases: ['snack'],
    }));
    const results = rankMenuItems('snack', bigMenu, 5);
    expect(results).toHaveLength(5);
  });

  test('returns empty for no match', () => {
    expect(rankMenuItems('sushi', MENU)).toEqual([]);
  });
});
