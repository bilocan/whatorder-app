const { buildReorderBasket, buildReorderPromptBody } = require('../reorder');

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

describe('buildReorderPromptBody', () => {
  test('embeds restaurant name in the header', () => {
    const body = buildReorderPromptBody(
      [{ name: 'Döner', qty: 2, price: 8.5 }], [], 'en', 'Döner Palace',
    );
    expect(body).toContain('Döner Palace');
    expect(body).toContain('Your last order:');
  });

  test('inserts single delivery minimum after welcome-back', () => {
    const body = buildReorderPromptBody(
      [{ name: 'Döner', qty: 1, price: 8.5 }],
      [],
      'de',
      'Pizza Favori',
      { deliveryEnabled: true, minimumOrderValue: 13 },
    );
    expect(body).toMatch(/Willkommen zurück bei Pizza Favori![\s\S]*\*Lieferung\* ab €13/);
    expect(body).toContain('Deine letzte Bestellung:');
    expect(body).not.toContain('Tippen Sie unten');
  });

  test('lists per-PLZ minimums when districts differ', () => {
    const body = buildReorderPromptBody(
      [{ name: 'Döner', qty: 1, price: 8.5 }],
      [],
      'de',
      'Pizza Favori',
      {
        deliveryEnabled: true,
        minimumOrderByDistrict: [
          { postalCodes: ['1100'], minimumOrderValue: 13 },
          { postalCodes: ['1040', '1050'], minimumOrderValue: 30 },
        ],
      },
    );
    expect(body).toContain('*Lieferung ab*');
    expect(body).toContain('• *1100* — ab €13');
    expect(body).toContain('• *1040, 1050* — ab €30');
  });
});
