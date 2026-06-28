const {
  norm,
  normalizeQtyWords,
  intentLearnKey,
  intentLearnKeyVariants,
  stripIntentPrefixes,
} = require('../intentNormalize');

describe('intentNormalize', () => {
  test('norm strips diacritics', () => {
    expect(norm('Döner')).toBe('doner');
    expect(norm('Hühner')).toBe('huhner');
  });

  test('normalizeQtyWords maps de/tr number words to digits', () => {
    expect(normalizeQtyWords('zwei doner und drei cola')).toBe('2 doner und 3 cola');
    expect(normalizeQtyWords('iki kebap')).toBe('2 kebap');
  });

  test('intentLearnKey canonicalizes prefixes and qty words', () => {
    expect(intentLearnKey('  Zwei Eiern noch dazu bitte  ')).toBe('2 eiern noch dazu');
    expect(intentLearnKey('ich hätte gerne zwei döner')).toBe('2 doner');
    expect(intentLearnKey('was für mich ein hühner döner und ne cola')).toBe(
      '1 huhner doner und ne cola',
    );
  });

  test('intentLearnKeyVariants includes legacy qty wording', () => {
    const variants = intentLearnKeyVariants('zwei cola');
    expect(variants).toContain('2 cola');
    expect(variants).toContain('zwei cola');
  });

  test('stripIntentPrefixes removes party-size phrases from learn keys', () => {
    expect(stripIntentPrefixes('für 4 personen zwei döner')).toBe('zwei döner');
    expect(intentLearnKey('für 4 personen zwei döner')).toBe('2 doner');
  });
});
