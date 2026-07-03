const { buildMenuLlmIndex } = require('../menuLlmIndex');
const { repairMenuLlmRawItems, repairIntentItems } = require('../menuLlmRepair');

const ENES_MENU = [
  { id: 'enes-kebap-sandwich-huhn', name: 'Kebap Sandwich Huhn', price: 7.5, category: 'Kebap', available: true },
  { id: 'enes-wrap-schafskase', name: 'Wrap mit Schafskäse', price: 5.5, category: 'Wraps', available: true },
  { id: 'enes-getr-cola-033', name: 'Coca Cola 0.33L', price: 2.9, category: 'Getraenke', available: true },
  { id: 'enes-getr-ayran-025', name: 'Mis Ayran 0.25L', price: 2, category: 'Getraenke', available: true },
];

describe('menuLlmRepair', () => {
  test('merges Schaf orphan into preceding kebab and remaps Eimer to Ayran', () => {
    const index = buildMenuLlmIndex(ENES_MENU);
    const badLlm = [
      { menuItemId: 'enes-kebap-sandwich-huhn', lineText: 'Kebab mit allem' },
      { menuItemId: 'enes-wrap-schafskase', lineText: 'Schaf' },
      { menuItemId: 'enes-getr-cola-033', lineText: 'Eimer' },
    ];

    const repaired = repairMenuLlmRawItems(badLlm, index);
    expect(repaired).toHaveLength(2);
    expect(repaired[0]).toMatchObject({
      menuItemId: 'enes-kebap-sandwich-huhn',
      lineText: 'Kebab mit allem und scharf',
    });
    expect(repaired[1]).toMatchObject({
      menuItemId: 'enes-getr-ayran-025',
      lineText: 'ayran',
    });
  });

  test('repairIntentItems fixes learned-cache replay shape', () => {
    const index = buildMenuLlmIndex(ENES_MENU);
    const learned = [
      { name: 'Kebab mit allem', qty: 1, menuItemId: 'enes-kebap-sandwich-huhn' },
      { name: 'Schaf', qty: 1, menuItemId: 'enes-wrap-schafskase' },
      { name: 'Eimer', qty: 1, menuItemId: 'enes-getr-cola-033' },
    ];

    const fixed = repairIntentItems(learned, index);
    expect(fixed).toHaveLength(2);
    expect(fixed[0].menuItemId).toBe('enes-kebap-sandwich-huhn');
    expect(fixed[0].name).toMatch(/und scharf/i);
    expect(fixed[1].menuItemId).toBe('enes-getr-ayran-025');
  });

  test('leaves valid multi-item orders unchanged', () => {
    const index = buildMenuLlmIndex(ENES_MENU);
    const ok = [
      { menuItemId: 'enes-kebap-sandwich-huhn', lineText: 'ein döner' },
      { menuItemId: 'enes-getr-cola-033', lineText: 'eine cola' },
    ];
    expect(repairMenuLlmRawItems(ok, index)).toEqual(ok);
  });
});
