// Localized chrome for WhatsApp Flows (labels, footers, cart/checkout copy).
// Bound in Flow JSON via ${data.ui_*}; filled by /flow/exchange from session.language.

const { FIELDS: F } = require('../flows/fields');
const { t: defaultT } = require('./templates');

const FLOW_LANGS = new Set(['de', 'en', 'tr']);

function resolveFlowLang(sessionOrLang) {
  const raw = typeof sessionOrLang === 'string'
    ? sessionOrLang
    : sessionOrLang?.language;
  const lang = String(raw || 'de').toLowerCase().slice(0, 2);
  return FLOW_LANGS.has(lang) ? lang : 'de';
}

function categorySelectCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('menuFlowScreenMenu', lang),
    [F.UI_CATEGORY_PROMPT]: t('menuFlowCategoryPrompt', lang),
    [F.UI_NEXT]: t('menuFlowNext', lang),
  };
}

function menuBrowseCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('menuFlowScreenMenu', lang),
    [F.UI_CUSTOMISE]: t('menuFlowCustomise', lang),
  };
}

function orderItemCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('menuFlowCustomise', lang),
    [F.UI_QTY_LABEL]: t('menuFlowQtyLabel', lang),
    [F.UI_NOTES_LABEL]: t('menuFlowNotesLabel', lang),
    [F.UI_NOTES_HELPER]: t('menuFlowNotesHelper', lang),
    [F.UI_ADD_TO_CART]: t('menuFlowAddToCart', lang),
  };
}

function cartEditCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('menuFlowCartTitle', lang),
    [F.UI_CART_HINT]: t('menuFlowCartHint', lang),
    [F.UI_REMOVE_LABEL]: t('menuFlowRemoveLabel', lang),
    [F.UI_REMOVE_SELECTED]: t('menuFlowRemoveSelected', lang),
    [F.UI_ADD_MORE]: t('menuFlowAddMore', lang),
    [F.UI_PLACE_ORDER]: t('menuFlowPlaceOrder', lang),
  };
}

function cartDoneCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('menuFlowCartTitle', lang),
    [F.UI_ADD_MORE]: t('menuFlowAddMore', lang),
    [F.UI_PLACE_ORDER]: t('menuFlowPlaceOrder', lang),
  };
}

function checkoutReviewCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('confirmListHeader', lang),
    [F.UI_NAME_LABEL]: t('confirmFlowNameLabel', lang),
    [F.UI_TYPE_LABEL]: t('confirmFlowTypeLabel', lang),
    [F.UI_ADDRESS_CHOICE_LABEL]: t('confirmFlowAddressChoiceLabel', lang),
    [F.UI_ADDRESS_LABEL]: t('confirmFlowAddressLabel', lang),
    [F.UI_APARTMENT_LABEL]: t('confirmFlowApartmentLabel', lang),
    [F.UI_APARTMENT_HELPER]: t('confirmFlowApartmentHelper', lang),
    [F.UI_NOTE_LABEL]: t('confirmFlowNoteLabel', lang),
    [F.UI_BACK_TO_CART]: t('confirmFlowBackToCart', lang),
    [F.UI_PLACE_ORDER]: t('confirmFlowFooter', lang),
    [F.UI_MANAGE_ADDRESSES_LINK]: t('confirmFlowManageAddressesLink', lang),
  };
}

function checkoutManageCopy(lang, t = defaultT) {
  return {
    [F.UI_MANAGE_SCREEN_TITLE]: t('confirmFlowManageTitle', lang),
    [F.UI_MANAGE_HINT]: t('confirmFlowManageHint', lang),
    [F.UI_MANAGE_SAVE]: t('confirmFlowManageSave', lang),
    [F.UI_MANAGE_SET_DEFAULT]: t('confirmFlowManageSetDefault', lang),
    [F.UI_MANAGE_DELETE]: t('confirmFlowManageDelete', lang),
    [F.UI_MANAGE_BACK]: t('confirmFlowManageBack', lang),
  };
}

function clearCartTitle(lang, t = defaultT) {
  return t('menuFlowClearCart', lang);
}

module.exports = {
  resolveFlowLang,
  categorySelectCopy,
  menuBrowseCopy,
  orderItemCopy,
  cartEditCopy,
  cartDoneCopy,
  checkoutReviewCopy,
  checkoutManageCopy,
  clearCartTitle,
};
