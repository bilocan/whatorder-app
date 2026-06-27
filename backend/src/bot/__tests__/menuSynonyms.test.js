const { expandNeedle, scoreStemTypo, MIN_FUZZY_SYNONYM_SCORE } = require('../menuSynonyms');
const { classifyMenuMatch, matchMenuItem } = require('../menuMatch');

const KEBAP_MENU = [
  { id: 'k1', name: 'Adana Kebap', price: 9.5, available: true },
  { id: 'k2', name: 'Urfa Kebap', price: 9.5, available: true },
  { id: 'a1', name: 'Ayran', price: 2, available: true },
  { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
  { id: 'c2', name: 'Coca Cola 0.5L', price: 3.5, available: true },
];

describe('expandNeedle', () => {
  test('döner expands to kebap terms', () => {
    const expanded = expandNeedle('döner');
    expect(expanded).toEqual(expect.arrayContaining(['doner', 'kebap', 'kebab']));
  });

  test('kebap expands to döner terms', () => {
    const expanded = expandNeedle('kebap');
    expect(expanded).toEqual(expect.arrayContaining(['doner', 'kebap']));
  });

  test('turkish pizza expands to lahmacun terms but bare pizza does not', () => {
    const turkish = expandNeedle('turkish pizza');
    expect(turkish).toEqual(expect.arrayContaining(['lahmacun', 'turkish pizza']));

    const pizza = expandNeedle('pizza');
    expect(pizza).not.toContain('lahmacun');
    expect(pizza).toContain('pizza');
  });

  test('fuzzy typo expands near-miss stems into synonym group (dner → döner/kebap)', () => {
    expect(scoreStemTypo('dner', 'doner')).toBeGreaterThanOrEqual(MIN_FUZZY_SYNONYM_SCORE);
    const expanded = expandNeedle('dner');
    expect(expanded).toEqual(expect.arrayContaining(['doner', 'kebap', 'kebab']));
  });

  test('fuzzy expansion does not match unrelated short tokens', () => {
    expect(scoreStemTypo('xyz', 'doner')).toBeLessThan(MIN_FUZZY_SYNONYM_SCORE);
    expect(expandNeedle('xyz')).toEqual(['xyz']);
  });
});

describe('classifyMenuMatch with synonyms', () => {
  test('döner matches kebap menu items as ambiguous', () => {
    const result = classifyMenuMatch('döner', KEBAP_MENU);
    expect(result.type).toBe('ambiguous');
    expect(result.items.map(i => i.name)).toEqual(
      expect.arrayContaining(['Adana Kebap', 'Urfa Kebap']),
    );
  });

  test('2 Döner intent line matches kebap via matchMenuItem', () => {
    expect(matchMenuItem('Döner', KEBAP_MENU)?.name).toMatch(/Kebap/);
  });

  test('bare cola defaults to 0.33L without disambiguation', () => {
    const result = classifyMenuMatch('cola', KEBAP_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Coca Cola 0.33L');
  });

  test('turkish pizza matches lahmacun menu item', () => {
    const menu = [{ id: 'l1', name: 'Lahmacun', price: 6.5, available: true }];
    const result = classifyMenuMatch('turkish pizza', menu);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Lahmacun');
  });
});
