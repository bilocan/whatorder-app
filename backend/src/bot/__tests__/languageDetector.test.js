const { detectLanguage, scoreLanguage, getOverride } = require('../languageDetector');

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

  test('detects Turkish from expanded keyword set (numbers + food)', () => {
    expect(detectLanguage('bir kebap için lütfen')).toBe('tr');
  });

  test('detects Turkish from expanded keyword set (food + drink)', () => {
    expect(detectLanguage('iki çay ve bir kahve')).toBe('tr');
  });

  test('detects German from expanded keyword set (numbers)', () => {
    expect(detectLanguage('zwei bier bitte danke')).toBe('de');
  });

  test('detects German from expanded keyword set (common words)', () => {
    expect(detectLanguage('ich möchte noch mehr bestellen')).toBe('de');
  });
});

describe('scoreLanguage', () => {
  test('returns score 0 and lang "en" for unknown text', () => {
    expect(scoreLanguage('hello world')).toEqual({ lang: 'en', score: 0 });
  });

  test('returns correct TR score', () => {
    const result = scoreLanguage('merhaba evet tamam');
    expect(result.lang).toBe('tr');
    expect(result.score).toBe(3);
  });

  test('returns correct DE score', () => {
    const result = scoreLanguage('hallo ich möchte bestellen bitte');
    expect(result.lang).toBe('de');
    expect(result.score).toBe(5);
  });

  test('score >= 2 for clear TR signal', () => {
    const result = scoreLanguage('bir döner için lütfen');
    expect(result.lang).toBe('tr');
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  test('score >= 2 for clear DE signal', () => {
    const result = scoreLanguage('zwei schnitzel bitte danke');
    expect(result.lang).toBe('de');
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  test('score is 0 when TR and DE are tied (both 0)', () => {
    const result = scoreLanguage('something completely unknown');
    expect(result.score).toBe(0);
  });

  test('score reflects max of winning language, not sum', () => {
    // 2 TR hits, 0 DE hits → score should be 2
    const result = scoreLanguage('merhaba tamam');
    expect(result.score).toBe(2);
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
