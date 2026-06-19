const { t, tCategory } = require('../templates');

const LOCALES = ['en', 'tr', 'de'];

// Every key that should exist across all three locales
const FUNCTION_KEYS = [
  'greeting', 'langChanged',
  'menuListHeader', 'menuListBody', 'menuListFooter', 'viewMenuBtn',
  'qtyBody',
  'itemAdded', 'addMoreBtn', 'viewBasketBtn', 'doneBtn',
  'basketHeader', 'basketEmpty', 'clearBasketBtn', 'confirmBtn',
  'orderTotal', 'confirmSummary', 'finalConfirmBody',
  'confirmOrderBtn', 'cancelOrderBtn', 'confirmPrompt', 'yesNoOnly',
  'orderConfirmed', 'orderCancelled', 'checkoutCancelled', 'orderReceipt',
  'menuEmpty',
  'orderReady',
];

describe('t() — key coverage', () => {
  // Pass extra dummy args; surplus args are silently ignored by JS
  const DUMMY_ARGS = ['RestaurantName', '10.00', 2, '14:30', 20];

  for (const lang of LOCALES) {
    describe(`locale: ${lang}`, () => {
      for (const key of FUNCTION_KEYS) {
        test(`"${key}" returns a non-empty string`, () => {
          const result = t(key, lang, ...DUMMY_ARGS);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        });
      }
    });
  }
});

describe('t() — fallback behaviour', () => {
  test('falls back to English for unknown locale', () => {
    expect(t('greeting', 'xx', 'MyRestaurant')).toBe(t('greeting', 'en', 'MyRestaurant'));
  });

  test('returns [key] placeholder for unknown key', () => {
    expect(t('nonExistentKey', 'en')).toBe('[nonExistentKey]');
    expect(t('nonExistentKey', 'tr')).toBe('[nonExistentKey]');
  });
});

describe('t() — interpolation', () => {
  test('greeting embeds restaurant name', () => {
    expect(t('greeting', 'en', 'Döner Palace')).toContain('Döner Palace');
    expect(t('greeting', 'de', 'Döner Palace')).toContain('Döner Palace');
    expect(t('greeting', 'tr', 'Döner Palace')).toContain('Döner Palace');
  });

  test('orderReady embeds shortId', () => {
    expect(t('orderReady', 'en', 'ABC123')).toContain('ABC123');
    expect(t('orderReady', 'de', 'ABC123')).toContain('ABC123');
    expect(t('orderReady', 'tr', 'ABC123')).toContain('ABC123');
  });

  test('orderConfirmed embeds shortId', () => {
    expect(t('orderConfirmed', 'en', 'XYZ789')).toContain('XYZ789');
    expect(t('orderConfirmed', 'tr', 'XYZ789')).toContain('XYZ789');
  });

  test('itemAdded embeds qty, name, and total', () => {
    const result = t('itemAdded', 'en', 2, 'Döner', 1, '8.50');
    expect(result).toContain('2');
    expect(result).toContain('Döner');
    expect(result).toContain('8.50');
  });

  test('orderTotal embeds formatted total', () => {
    expect(t('orderTotal', 'en', '17.00')).toContain('17.00');
    expect(t('orderTotal', 'de', '17.00')).toContain('17.00');
  });

  test('qtyBody embeds item name and price', () => {
    const result = t('qtyBody', 'en', 'Ayran', '2.00');
    expect(result).toContain('Ayran');
    expect(result).toContain('2.00');
  });
});

describe('tCategory()', () => {
  test('translates "mains" across all locales', () => {
    expect(tCategory('mains', 'en')).toBe('Mains');
    expect(tCategory('mains', 'de')).toBe('Hauptgerichte');
    expect(tCategory('mains', 'tr')).toBe('Ana Yemekler');
  });

  test('translates "sides" across all locales', () => {
    expect(tCategory('sides', 'en')).toBe('Sides');
    expect(tCategory('sides', 'de')).toBe('Beilagen');
    expect(tCategory('sides', 'tr')).toBe('Garnitürler');
  });

  test('translates "drinks" across all locales', () => {
    expect(tCategory('drinks', 'en')).toBe('Drinks');
    expect(tCategory('drinks', 'de')).toBe('Getränke');
    expect(tCategory('drinks', 'tr')).toBe('İçecekler');
  });

  test('falls back to English for unknown locale', () => {
    expect(tCategory('mains', 'xx')).toBe('Mains');
  });

  test('returns the raw key for an unknown category', () => {
    expect(tCategory('desserts', 'en')).toBe('desserts');
  });
});
