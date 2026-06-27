const { suggestItemAliases, stripSizeNoise } = require('../menuItemAliases');

describe('suggestItemAliases', () => {
  test('generates de/tr/en drink variants for Eistee', () => {
    const aliases = suggestItemAliases('Eistee Pfirsich 0.33L');
    expect(aliases).toEqual(expect.arrayContaining([
      'icetea pfirsich',
      'ice tea pfirsich',
      'eistee peach',
    ]));
  });

  test('generates kebab/chicken variants for Kebap Sandwich Huhn', () => {
    const aliases = suggestItemAliases('Kebap Sandwich Huhn');
    expect(aliases).toEqual(expect.arrayContaining([
      'doner sandwich huhn',
      'kebap sandwich chicken',
      'kebap sandwich tavuk',
    ]));
  });

  test('merges manual aliases without dropping them', () => {
    const aliases = suggestItemAliases('Pizza Margherita', { manual: ['margarita'] });
    expect(aliases).toContain('margarita');
    expect(aliases).toEqual(expect.arrayContaining(['pizza margarita', 'pizza margarete']));
  });

  test('does not alias the canonical name', () => {
    const aliases = suggestItemAliases('Cola 0.33L');
    expect(aliases).not.toContain('Cola 0.33L');
    expect(aliases).not.toContain('cola 0.33l');
  });
});

describe('stripSizeNoise', () => {
  test('removes litre and size markers', () => {
    expect(stripSizeNoise('Eistee Pfirsich 0.33L')).toBe('eistee pfirsich');
    expect(stripSizeNoise('Cheeseburger XXXL mit Pommes')).toBe('cheeseburger mit pommes');
  });
});
