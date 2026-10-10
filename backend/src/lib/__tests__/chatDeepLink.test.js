const {
  stripWallboardChannel,
  appendWallboardChannel,
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

  test('stripWallboardChannel removes a trailing tag and keeps the draft', () => {
    expect(stripWallboardChannel('Hallo #wo:qr')).toEqual({ text: 'Hallo', channel: 'qr' });
    expect(stripWallboardChannel('Hallo #wo:map\n')).toEqual({ text: 'Hallo', channel: 'map' });
    expect(stripWallboardChannel('ORDER biz_hamat_abc #wo:web')).toEqual({
      text: 'ORDER biz_hamat_abc',
      channel: 'web',
    });
    expect(stripWallboardChannel('Hallo #wo:qr please')).toEqual({
      text: 'Hallo #wo:qr please',
      channel: null,
    });
    expect(stripWallboardChannel('Hallo')).toEqual({ text: 'Hallo', channel: null });
  });

  test('stripped ORDER text still parses', () => {
    const { text } = stripWallboardChannel('ORDER biz_hamat_abc #wo:qr');
    expect(parseOrderDeepLink(text, ['biz_hamat_abc'])).toBe('biz_hamat_abc');
  });

  test('appendWallboardChannel tags qr, map, and web, and skips unknown ch', () => {
    expect(appendWallboardChannel('Hallo', undefined)).toBe('Hallo #wo:qr');
    expect(appendWallboardChannel('Hallo', '')).toBe('Hallo #wo:qr');
    expect(appendWallboardChannel('Hallo', 'qr')).toBe('Hallo #wo:qr');
    expect(appendWallboardChannel('Hallo', 'MAP')).toBe('Hallo #wo:map');
    expect(appendWallboardChannel('ORDER biz_hamat_abc', 'web')).toBe('ORDER biz_hamat_abc #wo:web');
    expect(appendWallboardChannel('Hallo', 'flyer')).toBe('Hallo');
  });
});
