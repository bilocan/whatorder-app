const { matchIntentToMenu, mergeIntoBasket } = require('../intentMatcher');

const MENU = [
  { id: '1', name: 'Döner', price: 8.5, aliases: ['doner'] },
  { id: '2', name: 'Cola', price: 2.5, aliases: ['coke', 'kola'] },
  { id: '3', name: 'Pizza Margherita', price: 12, aliases: ['pizza'] },
];

describe('matchIntentToMenu', () => {
  test('matches items and quantities', () => {
    const { matched, unmatched } = matchIntentToMenu(
      { items: [{ name: 'döner', qty: 2 }, { name: 'cola', qty: 1 }] },
      MENU,
    );
    expect(matched).toHaveLength(2);
    expect(matched[0]).toMatchObject({ name: 'Döner', qty: 2, price: 8.5 });
    expect(matched[1]).toMatchObject({ name: 'Cola', qty: 1, price: 2.5 });
    expect(unmatched).toEqual([]);
  });

  test('reports unmatched items', () => {
    const { matched, unmatched } = matchIntentToMenu(
      { items: [{ name: 'burger', qty: 1 }] },
      MENU,
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(['burger']);
  });

  test('matches via alias', () => {
    const { matched } = matchIntentToMenu({ items: [{ name: 'kola', qty: 1 }] }, MENU);
    expect(matched[0].name).toBe('Cola');
  });

  test('reports ambiguous match for döner variants', () => {
    const menu = [
      { id: '1', name: 'Döner', price: 8.5 },
      { id: '2', name: 'Döner Box', price: 9.5 },
      { id: '3', name: 'Döner Teller', price: 11 },
    ];
    const { matched, unmatched, disambiguation } = matchIntentToMenu(
      { items: [{ name: 'döner', qty: 1 }] },
      menu,
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(disambiguation).toMatchObject({ rawName: 'döner', qty: 1 });
    expect(disambiguation.candidates.length).toBeGreaterThan(1);
  });

  test('matches space-separated order regardless of menu order', () => {
    const menu = [
      { id: '3', name: 'Ayran', price: 2, aliases: [] },
      { id: '1', name: 'Döner', price: 8.5, aliases: ['doner'] },
    ];
    const { matched, unmatched } = matchIntentToMenu(
      { items: [{ name: 'Döner', qty: 2 }, { name: 'ayran', qty: 1 }] },
      menu,
    );
    expect(unmatched).toEqual([]);
    expect(matched).toEqual([
      expect.objectContaining({ name: 'Döner', qty: 2 }),
      expect.objectContaining({ name: 'Ayran', qty: 1 }),
    ]);
  });
});

describe('mergeIntoBasket', () => {
  test('merges quantities for same item', () => {
    const result = mergeIntoBasket(
      [{ name: 'Döner', qty: 1, price: 8.5 }],
      [{ name: 'Döner', qty: 2, price: 8.5 }],
    );
    expect(result).toEqual([{ name: 'Döner', qty: 3, price: 8.5 }]);
  });

  test('appends new items', () => {
    const result = mergeIntoBasket(
      [{ name: 'Döner', qty: 1, price: 8.5 }],
      [{ name: 'Cola', qty: 1, price: 2.5 }],
    );
    expect(result).toHaveLength(2);
  });
});
