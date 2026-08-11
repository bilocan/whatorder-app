const {
  resolveFlowLang,
  categorySelectCopy,
  clearCartTitle,
} = require('../menuFlowCopy');
const { FIELDS: F } = require('../../flows/fields');

describe('menuFlowCopy', () => {
  test('resolveFlowLang defaults to de and accepts de/en/tr', () => {
    expect(resolveFlowLang({})).toBe('de');
    expect(resolveFlowLang({ language: 'en' })).toBe('en');
    expect(resolveFlowLang({ language: 'TR' })).toBe('tr');
    expect(resolveFlowLang({ language: 'fr' })).toBe('de');
    expect(resolveFlowLang('en')).toBe('en');
  });

  test('categorySelectCopy returns localized chrome for all three langs', () => {
    expect(categorySelectCopy('de')[F.UI_NEXT]).toBe('Weiter');
    expect(categorySelectCopy('en')[F.UI_NEXT]).toBe('Next');
    expect(categorySelectCopy('tr')[F.UI_NEXT]).toBe('İleri');
  });

  test('clearCartTitle is localized', () => {
    expect(clearCartTitle('de')).toContain('Warenkorb');
    expect(clearCartTitle('en')).toContain('Clear');
    expect(clearCartTitle('tr')).toContain('Sepeti');
  });
});
