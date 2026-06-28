const { buildMenuLlmIndex, resolveMenuLlmItems } = require('../menuLlmIndex');

const MENU = [
  { id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5, category: 'Kebap', available: true },
  { id: 'a1', name: 'Ayran', price: 2, category: 'Getränke', available: true },
  { id: 'x1', name: 'Off menu', price: 1, available: false },
];

describe('menuLlmIndex', () => {
  test('buildMenuLlmIndex lists available items with ids', () => {
    const index = buildMenuLlmIndex(MENU);
    expect(index.count).toBe(2);
    expect(index.byId.has('k1')).toBe(true);
    expect(index.promptBlock).toMatch(/id=k1/);
    expect(index.promptBlock).not.toMatch(/Off menu/);
  });

  test('resolveMenuLlmItems maps ids to intent lines', () => {
    const index = buildMenuLlmIndex(MENU);
    const items = resolveMenuLlmItems([
      { menuItemId: 'k1', qty: 2, lineText: 'zwei kebap mit allem' },
      { menuItemId: 'a1', qty: 1 },
      { menuItemId: 'bogus', qty: 1 },
    ], index);
    expect(items).toEqual([
      { name: 'zwei kebap mit allem', qty: 2, menuItemId: 'k1' },
      { name: 'Ayran', qty: 1, menuItemId: 'a1' },
    ]);
  });
});
