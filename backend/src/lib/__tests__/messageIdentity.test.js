const {
  PLATFORM_IDENTITY,
  extractPlzOrt,
  formatRestaurantIdentity,
  runWithMessageIdentity,
  setMessageIdentity,
  applyBusinessInfoIdentity,
  getMessageIdentity,
  applyOutboundIdentity,
  isRestaurantBrandingHeader,
  prefixBodyWithIdentity,
} = require('../messageIdentity');

describe('extractPlzOrt', () => {
  test('parses street + PLZ + city', () => {
    expect(extractPlzOrt('Musterstrasse 1, 1010 Wien')).toBe('1010 Wien');
  });

  test('strips trailing Austria', () => {
    expect(extractPlzOrt('Hippgasse 11, 1160 Wien, Austria')).toBe('1160 Wien');
  });

  test('handles PLZ Ort only', () => {
    expect(extractPlzOrt('1170 Wien')).toBe('1170 Wien');
  });

  test('returns null when no PLZ', () => {
    expect(extractPlzOrt('Wien')).toBeNull();
    expect(extractPlzOrt('')).toBeNull();
    expect(extractPlzOrt(null)).toBeNull();
  });
});

describe('formatRestaurantIdentity', () => {
  test('formats Name, PLZ Ort', () => {
    expect(formatRestaurantIdentity('Enes', 'Panikengasse 1, 1170 Wien')).toBe('Enes, 1170 Wien');
  });

  test('falls back to name when address has no PLZ', () => {
    expect(formatRestaurantIdentity('Enes', 'Wien')).toBe('Enes');
  });

  test('falls back to WhatOrder when name missing', () => {
    expect(formatRestaurantIdentity('', '1170 Wien')).toBe(PLATFORM_IDENTITY);
    expect(formatRestaurantIdentity(null, null)).toBe(PLATFORM_IDENTITY);
  });
});

describe('applyOutboundIdentity', () => {
  test('no-ops outside ALS context', () => {
    expect(applyOutboundIdentity({ body: 'Hi', kind: 'text' })).toEqual({ body: 'Hi', header: null });
  });

  test('prefixes text body', async () => {
    await runWithMessageIdentity('Enes, 1170 Wien', async () => {
      expect(applyOutboundIdentity({ body: 'What would you like?', kind: 'text' })).toEqual({
        body: '*Enes, 1170 Wien*\n\nWhat would you like?',
        header: null,
      });
    });
  });

  test('does not double-prefix', async () => {
    await runWithMessageIdentity('Enes, 1170 Wien', async () => {
      const once = prefixBodyWithIdentity('Hi', 'Enes, 1170 Wien');
      expect(prefixBodyWithIdentity(once, 'Enes, 1170 Wien')).toBe(once);
    });
  });

  test('replaces restaurant branding list header', async () => {
    await runWithMessageIdentity('Döner Palace, 1010 Wien', async () => {
      expect(applyOutboundIdentity({
        body: 'Pick a category',
        header: '🍽️ Döner Palace',
        kind: 'list',
      })).toEqual({
        body: 'Pick a category',
        header: 'Döner Palace, 1010 Wien',
      });
    });
  });

  test('keeps semantic list header and prefixes body', async () => {
    await runWithMessageIdentity('Döner Palace, 1010 Wien', async () => {
      expect(applyOutboundIdentity({
        body: 'Choose one',
        header: 'Which one?',
        kind: 'list',
      })).toEqual({
        body: '*Döner Palace, 1010 Wien*\n\nChoose one',
        header: 'Which one?',
      });
    });
  });

  test('sets interactive header when absent', async () => {
    await runWithMessageIdentity('Enes, 1170 Wien', async () => {
      expect(applyOutboundIdentity({ body: 'Confirm?', kind: 'interactive' })).toEqual({
        body: 'Confirm?',
        header: 'Enes, 1170 Wien',
      });
    });
  });

  test('WhatOrder branding list header stays platform label', async () => {
    await runWithMessageIdentity(PLATFORM_IDENTITY, async () => {
      expect(applyOutboundIdentity({
        body: 'Pick a restaurant',
        header: 'WhatOrder',
        kind: 'list',
      })).toEqual({
        body: 'Pick a restaurant',
        header: 'WhatOrder',
      });
    });
  });
});

describe('ALS helpers', () => {
  test('setMessageIdentity updates store', async () => {
    await runWithMessageIdentity(PLATFORM_IDENTITY, async () => {
      expect(getMessageIdentity()).toBe(PLATFORM_IDENTITY);
      applyBusinessInfoIdentity({ name: 'Enes', address: 'x, 1170 Wien' });
      expect(getMessageIdentity()).toBe('Enes, 1170 Wien');
      setMessageIdentity(PLATFORM_IDENTITY);
      expect(getMessageIdentity()).toBe(PLATFORM_IDENTITY);
    });
  });

  test('isRestaurantBrandingHeader', () => {
    expect(isRestaurantBrandingHeader('WhatOrder', 'WhatOrder')).toBe(true);
    expect(isRestaurantBrandingHeader('🍽️ Enes', 'Enes, 1170 Wien')).toBe(true);
    expect(isRestaurantBrandingHeader('Which one?', 'Enes, 1170 Wien')).toBe(false);
  });
});
