const {
  mergePendingItems, matchIntentToMenu, findSuggestions, mergeIntoBasket, hydratePendingItems, expandPerUnitSpicyMatched,
} = require('../intentMatcher');

describe('mergePendingItems', () => {
  test('combines duplicate menuItemId with same modifier', () => {
    const items = [
      { menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 2, price: 7.5, modifierKey: 'mit:allem' },
      { menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 1, price: 7.5, modifierKey: 'mit:allem' },
    ];
    expect(mergePendingItems(items)).toEqual([
      { menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 3, price: 7.5, modifierKey: 'mit:allem' },
    ]);
  });
});

describe('matchIntentToMenu', () => {
  const MENU = [
    { id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5 },
    { id: 'a1', name: 'Ayran', price: 2 },
  ];

  test('menuItemId on intent line resolves directly', () => {
    const colaMenu = [
      { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
      { id: 'c2', name: 'Coca Cola 0.5L', price: 3.5, available: true },
      { id: 'd1', name: 'Döner', price: 8.5, available: true },
    ];
    const intent = {
      items: [
        { name: 'a kola', qty: 1, menuItemId: 'c1' },
        { name: 'döner', qty: 1, menuItemId: 'd1' },
      ],
    };
    const { matched, disambiguation } = matchIntentToMenu(intent, colaMenu);
    expect(disambiguation).toBeNull();
    expect(matched).toHaveLength(2);
    expect(matched.map(m => m.menuItemId)).toEqual(['c1', 'd1']);
  });

  test('merges duplicate unique matches across intent lines', () => {
    const intent = {
      items: [
        { name: 'Kebap Sandwich Huhn', qty: 2 },
        { name: 'Kebap Sandwich Huhn', qty: 1 },
      ],
    };
    const { matched, unmatched, disambiguation } = matchIntentToMenu(intent, MENU);
    expect(disambiguation).toBeNull();
    expect(unmatched).toEqual([]);
    expect(matched).toEqual([
      { menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 3, price: 7.5, optionGroups: [], rawIntentName: 'Kebap Sandwich Huhn', modifierKey: 'kebap sandwich huhn' },
    ]);
  });

  test('carries photoUrl from the matched menu item', () => {
    const PHOTO_MENU = [{ id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5, photoUrl: 'gs://bucket/kebap.jpg' }];
    const intent = { items: [{ name: 'Kebap Sandwich Huhn', qty: 1 }] };
    const { matched } = matchIntentToMenu(intent, PHOTO_MENU);
    expect(matched[0].photoUrl).toBe('gs://bucket/kebap.jpg');
  });

  test('leaves photoUrl undefined when menu item has none', () => {
    const intent = { items: [{ name: 'Ayran', qty: 1 }] };
    const { matched } = matchIntentToMenu(intent, MENU);
    expect(matched[0].photoUrl).toBeUndefined();
  });

  test('merges ingredient split when tokens match multi-ingredient product name', () => {
    const PIDE_MENU = [{ id: 'p1', name: 'Pide mit Gouda und Eiern', price: 9.9 }];
    const intent = {
      items: [
        { name: 'pide mit Eier', qty: 1 },
        { name: 'gouda', qty: 1 },
      ],
    };
    const { matched, unmatched } = matchIntentToMenu(intent, PIDE_MENU);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({
      menuItemId: 'p1',
      name: 'Pide mit Gouda und Eiern',
      qty: 1,
      rawIntentName: 'pide mit Eier und gouda',
    });
  });
});

describe('hydratePendingItems', () => {
  const MENU = [
    {
      id: 'k1',
      name: 'Kebap Sandwich Huhn',
      price: 7.5,
      optionGroups: [{ id: 'inserts', type: 'multi', options: [{ id: 'tomato', label: 'Tomato' }] }],
    },
    { id: 'a1', name: 'Ayran', price: 2 },
  ];

  test('restores optionGroups from menu when missing on pending line', () => {
    const pending = [{ menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 1, price: 7.5, optionGroups: [] }];
    const hydrated = hydratePendingItems(pending, MENU);
    expect(hydrated[0].optionGroups).toHaveLength(1);
  });

  test('leaves lines without menu optionGroups unchanged', () => {
    const pending = [{ menuItemId: 'a1', name: 'Ayran', qty: 1, price: 2, optionGroups: [] }];
    expect(hydratePendingItems(pending, MENU)[0].optionGroups).toEqual([]);
  });
});

describe('mergeIntoBasket', () => {
  test('merges same name and note', () => {
    const basket = [{ name: 'Kebap — Sauce', qty: 5, price: 7.5, note: 'extra scharf' }];
    const added = [{ name: 'Kebap — Sauce', qty: 1, price: 7.5, note: 'extra scharf' }];
    expect(mergeIntoBasket(basket, added)).toEqual([
      { name: 'Kebap — Sauce', qty: 6, price: 7.5, note: 'extra scharf' },
    ]);
  });

  test('keeps separate lines when note differs', () => {
    const basket = [{ name: 'Kebap — Sauce', qty: 5, price: 7.5 }];
    const added = [{ name: 'Kebap — Sauce', qty: 1, price: 7.5, note: 'extra scharf' }];
    expect(mergeIntoBasket(basket, added)).toEqual([
      { name: 'Kebap — Sauce', qty: 5, price: 7.5 },
      { name: 'Kebap — Sauce', qty: 1, price: 7.5, note: 'extra scharf' },
    ]);
  });
});

describe('expandPerUnitSpicyMatched', () => {
  const line = {
    menuItemId: 'k1',
    name: 'Kebap Sandwich Huhn',
    qty: 2,
    price: 7.5,
    optionGroups: [],
    rawIntentName: 'doner beide mit alles eine extra scharf bitte',
    modifierKey: 'doner beide mit alles eine extra scharf bitte',
  };

  test('splits collapsed 2x line when text says beide mit allem, eine scharf', () => {
    const raw = 'hallo wir hatten gerne zwei doner beide mit allen eine extra scharf bitte';
    const expanded = expandPerUnitSpicyMatched([line], raw);
    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toMatchObject({ qty: 1, rawIntentName: 'doner mit allen ohne scharf', modifierKey: 'ohne:scharf' });
    expect(expanded[1]).toMatchObject({ qty: 1, rawIntentName: 'doner mit allen und scharf', modifierKey: 'mit:allem+scharf' });
  });
});

describe('findSuggestions', () => {
  const MENU = [
    { id: 'd1', name: 'Tavuk Döner', price: 8.5 },
    { id: 'd2', name: 'Tavuk Dürüm Döneri', price: 9.0 },
    { id: 'a1', name: 'Ayran', price: 2.0 },
    { id: 'p1', name: 'Pommes', price: 3.5 },
  ];

  test('returns items sharing a token with the unmatched name', () => {
    const result = findSuggestions('döner', MENU);
    expect(result).toContain('Tavuk Döner');
  });

  test('returns at most 3 suggestions', () => {
    const bigMenu = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, name: `Döner Variante ${i}`, price: 8 }));
    expect(findSuggestions('döner', bigMenu).length).toBeLessThanOrEqual(3);
  });

  test('returns empty array when no token overlap exists', () => {
    expect(findSuggestions('sushi', MENU)).toEqual([]);
  });

  test('excludes unavailable items from suggestions', () => {
    const menuWithUnavailable = [
      { id: 'd1', name: 'Tavuk Döner', price: 8.5, available: false },
      { id: 'd2', name: 'Tavuk Dürüm Döneri', price: 9.0 },
    ];
    const result = findSuggestions('döner', menuWithUnavailable);
    expect(result).not.toContain('Tavuk Döner');
    expect(result).toContain('Tavuk Dürüm Döneri');
  });
});

describe('matchIntentToMenu — unmatchedSuggestions', () => {
  const MENU = [
    { id: 'd1', name: 'Tavuk Döner', price: 8.5 },
    { id: 'a1', name: 'Ayran', price: 2.0 },
  ];

  test('includes unmatchedSuggestions entry for a genuinely unmatched item', () => {
    // "Pizza" has no token overlap with menu items → unmatched with empty suggestions array
    const intent = { items: [{ name: 'Pizza', qty: 1 }, { name: 'Ayran', qty: 1 }] };
    const { unmatched, unmatchedSuggestions } = matchIntentToMenu(intent, MENU);
    expect(unmatched).toContain('Pizza');
    expect(unmatchedSuggestions).toHaveProperty('Pizza');
    expect(Array.isArray(unmatchedSuggestions['Pizza'])).toBe(true);
  });

  test('unmatchedSuggestions is empty object when all items match', () => {
    const intent = { items: [{ name: 'Ayran', qty: 1 }] };
    const { unmatched, unmatchedSuggestions } = matchIntentToMenu(intent, MENU);
    expect(unmatched).toHaveLength(0);
    expect(unmatchedSuggestions).toEqual({});
  });
});
