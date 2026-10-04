jest.mock('../../lib/collections', () => {
  const set = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn();
  return {
    customerPrefsRef: jest.fn(() => ({ get, set })),
  };
});

const { customerPrefsRef } = require('../../lib/collections');
const {
  getPreferredLanguage,
  setPreferredLanguage,
  langFromButtonId,
  languagePickButtons,
  languageRadioOptions,
  isSupportedLang,
} = require('../customerLanguage');

describe('customerLanguage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('isSupportedLang accepts de/en/tr only', () => {
    expect(isSupportedLang('de')).toBe(true);
    expect(isSupportedLang('fr')).toBe(false);
  });

  test('langFromButtonId maps reply buttons', () => {
    expect(langFromButtonId('btn_lang_de')).toBe('de');
    expect(langFromButtonId('btn_lang_en')).toBe('en');
    expect(langFromButtonId('btn_lang_tr')).toBe('tr');
    expect(langFromButtonId('btn_other')).toBeNull();
  });

  test('getPreferredLanguage returns null when missing', async () => {
    customerPrefsRef().get.mockResolvedValue({ exists: false });
    await expect(getPreferredLanguage('+143660')).resolves.toBeNull();
  });

  test('getPreferredLanguage returns stored language (digits key)', async () => {
    customerPrefsRef.mockImplementation((id) => ({
      get: jest.fn().mockResolvedValue(
        id === '43699'
          ? { exists: true, data: () => ({ preferredLanguage: 'tr' }) }
          : { exists: false },
      ),
      set: jest.fn(),
    }));
    await expect(getPreferredLanguage('+43699')).resolves.toBe('tr');
  });

  test('getPreferredLanguage finds legacy +prefixed prefs', async () => {
    customerPrefsRef.mockImplementation((id) => ({
      get: jest.fn().mockResolvedValue(
        id === '+43699'
          ? { exists: true, data: () => ({ preferredLanguage: 'en' }) }
          : { exists: false },
      ),
      set: jest.fn(),
    }));
    await expect(getPreferredLanguage('43699')).resolves.toBe('en');
  });

  test('setPreferredLanguage writes digits-only phone key', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    customerPrefsRef.mockImplementation(() => ({ get: jest.fn(), set }));
    await setPreferredLanguage('+43699', 'de');
    expect(customerPrefsRef).toHaveBeenCalledWith('43699');
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLanguage: 'de' }),
      { merge: true },
    );
  });

  test('languagePickButtons and radio options expose three languages', () => {
    const t = (key) => key;
    expect(languagePickButtons(t)).toHaveLength(3);
    expect(languageRadioOptions(t, 'en').map((o) => o.id)).toEqual(['de', 'en', 'tr']);
  });
});
