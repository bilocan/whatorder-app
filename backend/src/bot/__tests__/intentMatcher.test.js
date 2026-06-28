const {
  mergePendingItems, matchIntentToMenu, mergeIntoBasket, hydratePendingItems, expandPerUnitSpicyMatched,
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
