const { normalizeIntentItemName } = require('../intentModifiers');
const { matchIntentToMenu } = require('../intentMatcher');
const { parseIntent } = require('../intentParser');

describe('normalizeIntentItemName', () => {
  test('maps standalone Eier to ayran (TTS typo)', () => {
    expect(normalizeIntentItemName('Eier')).toBe('ayran');
    expect(normalizeIntentItemName('eier bitte')).toBe('ayran');
  });

  test('maps Eimer standalone drink typo to ayran', () => {
    expect(normalizeIntentItemName('Eimer')).toBe('ayran');
  });

  test('maps Eiern with short continuation filler (TTS + noch dazu)', () => {
    expect(normalizeIntentItemName('Eiern noch dazu bitte')).toBe('ayran');
  });

  test('maps einem to ayran (TTS mishears ein Ayran)', () => {
    expect(normalizeIntentItemName('einem')).toBe('ayran');
    expect(normalizeIntentItemName('einem bitte')).toBe('ayran');
  });

  test('does not map typo token when followed by food words', () => {
    expect(normalizeIntentItemName('einem kebap bitte')).toBe('einem kebap');
    expect(normalizeIntentItemName('einem kebap bitte ich')).toBe('einem kebap bitte ich');
    expect(normalizeIntentItemName('meinen kebap bitte')).toBe('meinen kebap');
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

  test('ein kebap und ein einem matches ayran (TTS)', () => {
    const intent = parseIntent('ein kebap und ein einem bitte');
    const { matched, unmatched } = matchIntentToMenu(intent, menu);
    expect(unmatched).toEqual([]);
    expect(matched.map(m => m.name)).toEqual([
      'Kebap Sandwich Huhn',
      'Mis Ayran 0.25L',
    ]);
  });

  test('einem kebap stays food not ayran drink', () => {
    const intent = parseIntent('einem kebap bitte ich');
    const { matched, unmatched } = matchIntentToMenu(intent, menu);
    expect(unmatched).toEqual([]);
    expect(matched.map(m => m.name)).toEqual(['Kebap Sandwich Huhn']);
    expect(matched.find(m => m.name.includes('Ayran'))).toBeUndefined();
  });

  test('pide mit eiern stays egg pide not ayran', () => {
    const intent = parseIntent('pide mit eiern');
    const { matched, unmatched } = matchIntentToMenu(intent, menu);
    expect(unmatched).toEqual([]);
    expect(matched.map(m => m.name)).toEqual(['Pide mit Gouda und Eiern']);
  });

  test('pide mit eier und gouda is one item not duplicated', () => {
    const intent = parseIntent('Eine pide mit Eier und gouda');
    const { matched, unmatched } = matchIntentToMenu(intent, menu);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({
      name: 'Pide mit Gouda und Eiern',
      qty: 1,
      rawIntentName: 'pide mit Eier und gouda',
    });
  });
});
