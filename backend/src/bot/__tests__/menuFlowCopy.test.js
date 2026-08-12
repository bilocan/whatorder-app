const {
  resolveFlowLang,
  categorySelectCopy,
  checkoutReviewCopy,
  checkoutManageCopy,
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

  test('checkoutReviewCopy includes manage addresses link', () => {
    expect(checkoutReviewCopy('en')[F.UI_MANAGE_ADDRESSES_LINK]).toBe('Manage addresses');
    expect(checkoutReviewCopy('de')[F.UI_MANAGE_ADDRESSES_LINK]).toBe('Adressen verwalten');
    expect(checkoutReviewCopy('tr')[F.UI_MANAGE_ADDRESSES_LINK]).toBe('Adresleri yönet');
  });

  test('checkoutManageCopy returns localized manage chrome', () => {
    expect(checkoutManageCopy('en')[F.UI_MANAGE_SAVE]).toBe('Save');
    expect(checkoutManageCopy('de')[F.UI_MANAGE_SAVE]).toBe('Speichern');
    expect(checkoutManageCopy('tr')[F.UI_MANAGE_SAVE]).toBe('Kaydet');
  });
});
