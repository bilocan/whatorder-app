const { applyRemoveQty } = require('../intentRemoveQty');

describe('intentRemoveQty', () => {
  const basket = [
    { name: 'Mis Ayran 0.25L', qty: 3, price: 2, menuItemId: 'a1' },
    { name: 'Cola', qty: 1, price: 2.5, menuItemId: 'c1' },
  ];

  test('removes one unit from a multi-qty line', () => {
    const next = applyRemoveQty(basket, {
      menuItemId: 'a1',
      name: 'Mis Ayran 0.25L',
      qty: 1,
    });
    expect(next).toEqual([
      { name: 'Mis Ayran 0.25L', qty: 2, price: 2, menuItemId: 'a1' },
      { name: 'Cola', qty: 1, price: 2.5, menuItemId: 'c1' },
    ]);
  });

  test('removeAll drops every matching line', () => {
    const lines = [
      { name: 'Mis Ayran 0.25L', qty: 1, menuItemId: 'a1' },
      { name: 'Mis Ayran 0.25L', qty: 1, menuItemId: 'a1' },
      { name: 'Cola', qty: 1, menuItemId: 'c1' },
    ];
    const next = applyRemoveQty(lines, {
      menuItemId: 'a1',
      name: 'Mis Ayran 0.25L',
      removeAll: true,
    });
    expect(next).toEqual([{ name: 'Cola', qty: 1, menuItemId: 'c1' }]);
  });
});
