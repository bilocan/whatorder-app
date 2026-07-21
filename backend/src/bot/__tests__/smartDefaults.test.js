const { trySmartDefault, hasExplicitDrinkSize } = require('../smartDefaults');
const { classifyMenuMatch } = require('../menuMatch');

const COLA_MENU = [
  { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
  { id: 'c2', name: 'Coca Cola 0.5L', price: 3.5, available: true },
];

const COLA_STEM_MATCH = {
  defaults: {
    stemDefaults: { cola: 'c1', kola: 'c1', coke: 'c1' },
  },
};

const KEBAB_MENU = [
  { id: 'p1', name: 'Pizza Kebap Huhn (33cm)', price: 15.9, available: true },
  { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
  { id: 'd1', name: 'Döner', price: 8.5, available: true },
  { id: 'd2', name: 'Döner Box', price: 9.5, available: true },
];

describe('trySmartDefault — drinks', () => {
  test('bare cola stays ambiguous without owner stemDefaults', () => {
    expect(trySmartDefault('cola', COLA_MENU)).toBeNull();
    expect(classifyMenuMatch('cola', COLA_MENU).type).toBe('ambiguous');
  });

  test('owner stemDefaults resolve bare cola to configured SKU', () => {
    expect(trySmartDefault('cola', COLA_MENU, COLA_STEM_MATCH)?.id).toBe('c1');
    expect(trySmartDefault('ein Cola', COLA_MENU, COLA_STEM_MATCH)?.id).toBe('c1');
    const result = classifyMenuMatch('cola', COLA_MENU, COLA_STEM_MATCH);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('c1');
  });

  test('hasExplicitDrinkSize detects size in phrase', () => {
    expect(hasExplicitDrinkSize('cola 0,5')).toBe(true);
  });

  test('menu defaultVariant overrides when multiple drink SKUs match', () => {
    const menu = [
      { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
      { id: 'c2', name: 'Coca Cola 0.5L', price: 3.5, available: true, defaultVariant: true },
    ];
    expect(trySmartDefault('cola', menu)?.id).toBe('c2');
  });
});

describe('trySmartDefault — kebab', () => {
  test('Hühner Kebab prefers sandwich over pizza', () => {
    expect(trySmartDefault('Hühner Kebab', KEBAB_MENU)?.id).toBe('s1');
    const result = classifyMenuMatch('Hühner Kebab', KEBAB_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('s1');
  });

  test('glued hühnerkebab prefers sandwich over pizza', () => {
    expect(classifyMenuMatch('hühnerkebab', KEBAB_MENU).item.id).toBe('s1');
  });

  test('döner box vs döner stays ambiguous', () => {
    const menu = [
      { id: 'd1', name: 'Döner', price: 8.5, available: true },
      { id: 'd2', name: 'Döner Box', price: 9.5, available: true },
    ];
    expect(trySmartDefault('döner', menu)).toBeNull();
    expect(classifyMenuMatch('döner', menu).type).toBe('ambiguous');
  });

  test('fuzzy kebab typo defaults like exact stem (dner → sandwich)', () => {
    expect(trySmartDefault('dner', KEBAB_MENU)?.id).toBe('s1');
    expect(classifyMenuMatch('dner', KEBAB_MENU).item.id).toBe('s1');
  });

  test('owner stemDefaults override ambiguous döner list', () => {
    const menu = [
      { id: 'd1', name: 'Döner', price: 8.5, available: true },
      { id: 'd2', name: 'Döner Box', price: 9.5, available: true },
      { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
    ];
    const menuMatch = {
      defaults: {
        stemDefaults: { doner: 's1', döner: 's1', kebap: 's1' },
      },
    };
    expect(trySmartDefault('döner', menu, menuMatch)?.id).toBe('s1');
    expect(classifyMenuMatch('döner', menu, menuMatch).type).toBe('unique');
    expect(classifyMenuMatch('döner', menu, menuMatch).item.id).toBe('s1');
  });

  test('owner kebap default does not override explicit dürüm', () => {
    const menu = [
      { id: 'dur', name: 'Enes Kebap Special Dürüm Huhn', price: 9.5, available: true },
      { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
    ];
    const menuMatch = {
      defaults: { stemDefaults: { kebap: 's1', doner: 's1' } },
    };
    expect(classifyMenuMatch('dürüm', menu, menuMatch).item.id).toBe('dur');
  });

  test('bare durum prefers plain Dürüm Huhn over cheaper Special', () => {
    const menu = [
      { id: 'plain', name: 'Dürüm Huhn', price: 8.5, available: true },
      { id: 'special', name: 'Enes Kebap Special Dürüm Huhn', price: 6.9, available: true },
      { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
    ];
    expect(trySmartDefault('durum', menu)?.id).toBe('plain');
    const result = classifyMenuMatch('durum', menu);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('plain');
  });

  test('bare durum stays ambiguous across multiple plain dürüm SKUs', () => {
    const menu = [
      { id: 'huhn', name: 'Dürüm Huhn', price: 8.5, available: true },
      { id: 'falafel', name: 'Falafel Dürüm', price: 7.0, available: true },
      { id: 'special', name: 'Enes Kebap Special Dürüm Huhn', price: 6.9, available: true },
      { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
    ];
    expect(trySmartDefault('durum', menu)).toBeNull();
    expect(classifyMenuMatch('durum', menu).type).toBe('ambiguous');
  });

  test('explicit special durum still resolves to Special SKU', () => {
    const menu = [
      { id: 'plain', name: 'Dürüm Huhn', price: 8.5, available: true },
      { id: 'special', name: 'Enes Kebap Special Dürüm Huhn', price: 6.9, available: true },
      { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
    ];
    expect(trySmartDefault('special durum', menu)?.id).toBe('special');
    const result = classifyMenuMatch('special durum', menu);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('special');
  });
});

describe('classifyMenuMatch with smart defaults', () => {
  test('explicit Coca Cola 0.33L SKU resolves without disambiguation', () => {
    const menu = [
      { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
      { id: 'c2', name: 'Coca Cola 0.5L', price: 3.5, available: true },
      { id: 'c3', name: 'Coca Cola 1.5L', price: 5.5, available: true },
      { id: 'c4', name: 'Coca Cola Light 0.33L', price: 2.9, available: true },
    ];
    expect(trySmartDefault('Coca Cola 0.33L', menu)).toBeNull();
    const result = classifyMenuMatch('Coca Cola 0.33L', menu);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('c1');
  });
});
