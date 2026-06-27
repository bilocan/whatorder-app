const { trySmartDefault, hasExplicitDrinkSize } = require('../smartDefaults');
const { classifyMenuMatch } = require('../menuMatch');

const COLA_MENU = [
  { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
  { id: 'c2', name: 'Coca Cola 0.5L', price: 3.5, available: true },
];

const KEBAB_MENU = [
  { id: 'p1', name: 'Pizza Kebap Huhn (33cm)', price: 15.9, available: true },
  { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
  { id: 'd1', name: 'Döner', price: 8.5, available: true },
  { id: 'd2', name: 'Döner Box', price: 9.5, available: true },
];

describe('trySmartDefault — drinks', () => {
  test('bare cola picks 0.33L (Austria default)', () => {
    expect(trySmartDefault('cola', COLA_MENU)?.id).toBe('c1');
    expect(trySmartDefault('ein Cola', COLA_MENU)?.id).toBe('c1');
  });

  test('explicit 0.5L picks large', () => {
    expect(trySmartDefault('Cola 0.5L', COLA_MENU)?.id).toBe('c2');
    expect(hasExplicitDrinkSize('cola 0,5')).toBe(true);
  });

  test('menu defaultVariant overrides size heuristic', () => {
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
});

describe('classifyMenuMatch with smart defaults', () => {
  test('cola resolves to 0.33L without disambiguation list', () => {
    const result = classifyMenuMatch('cola', COLA_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Coca Cola 0.33L');
  });
});
