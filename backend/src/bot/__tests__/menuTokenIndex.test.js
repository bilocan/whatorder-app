const { buildMenuTokenIndex, findTokenIndexMatches, scoreTokenOverlap } = require('../menuTokenIndex');

const MENU = [
  { id: 'p1', name: 'Pizza Spinaci', price: 9, available: true },
  { id: 'p2', name: 'Pizza Margherita', price: 8, available: true },
  { id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true, aliases: ['huhner kebap sandwich'] },
  { id: 'c1', name: 'Coca Cola 0.33L', price: 2.5, available: true, aliases: ['cola'] },
];

describe('menuTokenIndex', () => {
  const index = buildMenuTokenIndex(MENU);

  test('unique hit when query tokens cover one menu item', () => {
    const hits = findTokenIndexMatches('spinaci', index);
    expect(hits).toHaveLength(1);
    expect(hits[0].item.id).toBe('p1');
  });

  test('matches via aliases', () => {
    const hits = findTokenIndexMatches('huhner kebap', index);
    expect(hits.some(h => h.item.id === 'k1')).toBe(true);
  });

  test('ambiguous when multiple items share tokens', () => {
    const hits = findTokenIndexMatches('pizza', index);
    expect(hits.length).toBeGreaterThan(1);
  });

  test('scoreTokenOverlap prefers full query coverage', () => {
    const full = scoreTokenOverlap(['pizza', 'spinaci'], ['pizza', 'spinaci']);
    const partial = scoreTokenOverlap(['pizza'], ['pizza', 'spinaci', 'margherita']);
    expect(full).toBeGreaterThan(partial);
  });
});
