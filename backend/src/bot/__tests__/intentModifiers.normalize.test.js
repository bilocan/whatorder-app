const { normalizeIntentItemName } = require('../intentModifiers');
const { matchIntentToMenu } = require('../intentMatcher');
const { parseIntent } = require('../intentParser');

describe('normalizeIntentItemName', () => {
  test('maps standalone Eier to ayran (TTS typo)', () => {
    expect(normalizeIntentItemName('Eier')).toBe('ayran');
    expect(normalizeIntentItemName('eier bitte')).toBe('ayran');
  });

  test('does not rewrite multi-word food names', () => {
    expect(normalizeIntentItemName('Pide mit Eiern')).toBe('Pide mit Eiern');
  });
});

describe('Eier TTS typo does not match Pide', () => {
  const menu = [
    { id: 's1', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
    { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true },
    { id: 'a1', name: 'Mis Ayran 0.25L', price: 2.5, available: true },
    { id: 'p1', name: 'Pide mit Gouda und Eiern', price: 9.9, available: true },
    { id: 'd1', name: 'Enes Kebap Special Dürüm Huhn', price: 6.9, available: true },
  ];

  test('ein Eier after cola matches ayran not pide', () => {
    const intent = parseIntent('Zwei Hühner Kebab ein Cola und ein Eier bitte');
    const { matched, unmatched } = matchIntentToMenu(intent, menu);
    expect(unmatched).toEqual([]);
    expect(matched.map(m => m.name)).toEqual([
      'Kebap Sandwich Huhn',
      'Coca Cola 0.33L',
      'Mis Ayran 0.25L',
    ]);
    expect(matched.find(m => m.name.includes('Pide'))).toBeUndefined();
    expect(matched.find(m => m.name.includes('Dürüm'))).toBeUndefined();
  });
});
