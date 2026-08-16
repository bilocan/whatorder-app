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

  test('checkoutReviewCopy includes profile edit link', () => {
    expect(checkoutReviewCopy('en')[F.UI_MANAGE_ADDRESSES_LINK]).toBe('Address & profile');
    expect(checkoutReviewCopy('de')[F.UI_MANAGE_ADDRESSES_LINK]).toBe('Adresse & Profil');
    expect(checkoutReviewCopy('tr')[F.UI_MANAGE_ADDRESSES_LINK]).toBe('Adres ve profil');
  });

  test('checkoutManageCopy returns localized manage chrome', () => {
    expect(checkoutManageCopy('en')[F.UI_MANAGE_SAVE]).toBe('Save');
    expect(checkoutManageCopy('de')[F.UI_MANAGE_SAVE]).toBe('Speichern');
    expect(checkoutManageCopy('tr')[F.UI_MANAGE_SAVE]).toBe('Kaydet');
    expect(checkoutManageCopy('en')[F.UI_MANAGE_SCREEN_TITLE]).toBe('Profile');
    expect(checkoutManageCopy('en')[F.UI_PROFILE_NAME_LABEL]).toBe('Your name');
    expect(checkoutManageCopy('de', undefined, { savedCount: 3 })[F.UI_MANAGE_HINT])
      .toBe('Gespeicherte Adressen (3/5)');
    expect(checkoutManageCopy('en')[F.UI_MANAGE_EDIT_CAPTION]).toBe('Edit the selected address');
    expect(checkoutManageCopy('de')[F.UI_MANAGE_SET_DEFAULT]).toBe('Als Standardadresse speichern');
    expect(checkoutManageCopy('de')[F.UI_MANAGE_CONFIRM_YES]).toBe('Ja');
    expect(checkoutManageCopy('tr')[F.UI_MANAGE_CONFIRM_EDIT]).toBe('Düzenle');
    expect(checkoutReviewCopy('de')[F.UI_ADDRESS_HELPER])
      .toBe('Straße und Hausnummer (z. B. Lavaterstrasse 3)');
  });
});
