const { buildReorderBasket } = require('../reorder');

const MENU = [
  { id: 'item_1', name: 'Döner', price: 8.5, available: true },
  { id: 'item_2', name: 'Ayran', price: 2.0, available: true },
  { id: 'item_3', name: 'Old Special', price: 5.0, available: false },
];

describe('buildReorderBasket', () => {
  test('maps last order lines to current menu with updated prices', () => {
    const { matched, unmatched } = buildReorderBasket(
      [{ name: 'Döner', qty: 2, price: 7.0 }, { name: 'Ayran', qty: 1, price: 2.0 }],
      MENU,
    );
    expect(matched).toEqual([
      { name: 'Döner', qty: 2, price: 8.5 },
      { name: 'Ayran', qty: 1, price: 2.0 },
    ]);
    expect(unmatched).toEqual([]);
  });

  test('matches customized line names via base name before em dash', () => {
    const { matched, unmatched } = buildReorderBasket(
      [{ name: 'Döner — Chicken, Tomato', qty: 1, price: 8.5 }],
      MENU,
    );
    expect(matched).toEqual([{ name: 'Döner', qty: 1, price: 8.5 }]);
    expect(unmatched).toEqual([]);
  });

  test('marks unavailable or missing items as unmatched', () => {
    const { matched, unmatched } = buildReorderBasket(
      [{ name: 'Old Special', qty: 1, price: 5.0 }, { name: 'Pizza', qty: 1, price: 9.0 }],
      MENU,
    );
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(['Old Special', 'Pizza']);
  });

  test('clamps qty to 1–99', () => {
    const { matched } = buildReorderBasket([{ name: 'Döner', qty: 0, price: 8.5 }], MENU);
    expect(matched[0].qty).toBe(1);
  });
});
