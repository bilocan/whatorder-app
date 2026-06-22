const { mergePendingItems, matchIntentToMenu } = require('../intentMatcher');

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
});
