const {
  parseOrderDeepLink,
  buildOrderDeepLinkPrefill,
  chatPrefillFromQuery,
} = require('../chatDeepLink');

describe('chatDeepLink', () => {
  const IDS = ['biz_hamat_abc', 'biz_pizza_xyz'];

  test('parseOrderDeepLink matches businessId case-insensitively', () => {
    expect(parseOrderDeepLink('ORDER biz_hamat_abc', IDS)).toBe('biz_hamat_abc');
    expect(parseOrderDeepLink('ORDER+biz_hamat_abc', IDS)).toBe('biz_hamat_abc');
    expect(parseOrderDeepLink('order BIZ_HAMAT_ABC', IDS)).toBe('biz_hamat_abc');
  });

  test('parseOrderDeepLink returns null for unknown or non-matching text', () => {
    expect(parseOrderDeepLink('Bestellen', IDS)).toBeNull();
    expect(parseOrderDeepLink('ORDER+unknown', IDS)).toBeNull();
    expect(parseOrderDeepLink('ORDER+biz_hamat_abc', [])).toBeNull();
  });

  test('buildOrderDeepLinkPrefill embeds businessId', () => {
    expect(buildOrderDeepLinkPrefill('biz_hamat_abc')).toBe('ORDER biz_hamat_abc');
  });

  test('chatPrefillFromQuery prefers bid over text', () => {
    expect(chatPrefillFromQuery({ bid: 'biz_hamat_abc', text: 'Hallo' }))
      .toBe('ORDER biz_hamat_abc');
    expect(chatPrefillFromQuery({ text: 'Bestellen' })).toBe('Bestellen');
    expect(chatPrefillFromQuery({})).toBeNull();
  });

  test('isOrderDeepLink detects ORDER token messages', () => {
    const { isOrderDeepLink } = require('../chatDeepLink');
    expect(isOrderDeepLink('ORDER biz_hamat_abc')).toBe(true);
    expect(isOrderDeepLink('ORDER+biz_hamat_abc')).toBe(true);
    expect(isOrderDeepLink('Bestellen')).toBe(false);
  });
});
