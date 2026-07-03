const { buildMenuLlmIndex } = require('../menuLlmIndex');
const { buildMenuMatchIndex } = require('../menuMapper');
const {
  rebindLearnedItemsToMenu,
  learnedItemIdsChanged,
} = require('../intentLearningRebind');
const { repairIntentItems } = require('../menuLlmRepair');

const MENU = [
  { id: 'enes-lahmacun', name: 'Lahmacun', price: 6.5, category: 'Pide', available: true },
  { id: 'enes-cola-033', name: 'Coca Cola 0.33L', price: 2.9, category: 'Getraenke', available: true },
  { id: 'enes-kebap-sandwich-huhn', name: 'Kebap Sandwich Huhn', price: 7.5, category: 'Kebap', available: true },
];

describe('intentLearningRebind', () => {
  test('rebindLearnedItemsToMenu resolves stale menuItemIds by name', () => {
    const learned = [
      { name: 'Lahmacun', qty: 1, menuItemId: 'old-lahmacun-id' },
      { name: 'Cola', qty: 1, menuItemId: 'old-cola-id' },
    ];
    const rebound = rebindLearnedItemsToMenu(learned, MENU, buildMenuMatchIndex(MENU));
    expect(rebound).toHaveLength(2);
    expect(rebound[0].menuItemId).toBe('enes-lahmacun');
    expect(rebound[0].name).toBe('Lahmacun');
    expect(rebound[1].menuItemId).toBe('enes-cola-033');
    expect(learnedItemIdsChanged(learned, rebound)).toBe(true);
  });

  test('repairIntentItems rebinds when all stored ids are stale', () => {
    const index = buildMenuLlmIndex(MENU);
    const learned = [
      { name: 'Lahmacun', qty: 1, menuItemId: 'old-lahmacun-id' },
      { name: 'Cola', qty: 1, menuItemId: 'old-cola-id' },
    ];
    const fixed = repairIntentItems(learned, index);
    expect(fixed).toHaveLength(2);
    expect(fixed[0].menuItemId).toBe('enes-lahmacun');
    expect(fixed[1].menuItemId).toBe('enes-cola-033');
  });
});
