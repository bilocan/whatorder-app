const { detectLanguage, getOverride } = require('../languageDetector');

describe('detectLanguage', () => {
  test('detects Turkish from keywords', () => {
    expect(detectLanguage('Merhaba sipariş vermek istiyorum')).toBe('tr');
  });

  test('detects German from keywords', () => {
    expect(detectLanguage('Hallo ich möchte bestellen bitte danke')).toBe('de');
  });

  test('falls back to English when no known keywords match', () => {
    expect(detectLanguage('Hello I want to order please')).toBe('en');
  });

  test('falls back to English when TR and DE scores are tied', () => {
    expect(detectLanguage('something completely random')).toBe('en');
  });

  test('is case-insensitive', () => {
    expect(detectLanguage('MERHABA')).toBe('tr');
    expect(detectLanguage('HALLO')).toBe('de');
  });

  test('handles punctuation delimiters', () => {
    expect(detectLanguage('Merhaba, sipariş lütfen!')).toBe('tr');
    expect(detectLanguage('Hallo, bitte bestellen!')).toBe('de');
  });

  test('accepts diacritic-free Turkish equivalents', () => {
    expect(detectLanguage('siparis istiyorum')).toBe('tr');
    expect(detectLanguage('turkce lutfen')).toBe('tr');
  });

  test('TR score beats DE score when both have matches', () => {
    // 3 TR words vs 1 DE word
    expect(detectLanguage('merhaba tamam sipariş ja')).toBe('tr');
  });
});

describe('getOverride', () => {
  test('returns "en" for "english"', () => {
    expect(getOverride('english')).toBe('en');
  });

  test('returns "de" for "deutsch"', () => {
    expect(getOverride('deutsch')).toBe('de');
  });

  test('returns "tr" for "türkçe"', () => {
    expect(getOverride('türkçe')).toBe('tr');
  });

  test('returns "tr" for "turkce"', () => {
    expect(getOverride('turkce')).toBe('tr');
  });

  test('is case-insensitive', () => {
    expect(getOverride('English')).toBe('en');
    expect(getOverride('DEUTSCH')).toBe('de');
    expect(getOverride('TURKCE')).toBe('tr');
  });

  test('trims surrounding whitespace', () => {
    expect(getOverride('  english  ')).toBe('en');
    expect(getOverride('  deutsch  ')).toBe('de');
  });

  test('returns null for unrecognised text', () => {
    expect(getOverride('hello')).toBeNull();
    expect(getOverride('bonjour')).toBeNull();
    expect(getOverride('')).toBeNull();
  });
});
