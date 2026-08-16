// Localized chrome for WhatsApp Flows (labels, footers, cart/checkout copy).
// Bound in Flow JSON via ${data.ui_*}; filled by /flow/exchange from session.language.

const { FIELDS: F } = require('../flows/fields');
const { t: defaultT } = require('./templates');

const FLOW_LANGS = new Set(['de', 'en', 'tr']);
/** Match checkoutConfirmFlow.MAX_SAVED_ADDRESS_OPTIONS (avoid circular require). */
const DEFAULT_MAX_SAVED_ADDRESSES = 5;

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
    [F.UI_QTY_HELPER]: t('menuFlowQtyHelper', lang),
    [F.UI_NOTES_LABEL]: t('menuFlowNotesLabel', lang),
    [F.UI_NOTES_HELPER]: t('menuFlowNotesHelper', lang),
    [F.UI_ADD_TO_CART]: t('menuFlowAddToCart', lang),
    [F.UI_FOOTER_LEFT_CAPTION]: t('menuFlowFooterLeftCaption', lang),
  };
}

function cartEditCopy(lang, t = defaultT) {
  return {
    [F.UI_SCREEN_TITLE]: t('menuFlowCartTitle', lang),
    [F.UI_CART_HINT]: t('menuFlowCartHint', lang),
    [F.UI_REMOVE_LABEL]: t('menuFlowRemoveLabel', lang),
    [F.UI_REMOVE_MODE_LABEL]: t('menuFlowRemoveModeLabel', lang),
    // Meta EmbeddedLink max 25 chars; apply after radio mode.
    [F.UI_REMOVE_SELECTED]: t('menuFlowRemoveSelected', lang),
    [F.UI_ADD_MORE]: t('menuFlowAddMore', lang),
    [F.UI_PLACE_ORDER]: t('menuFlowPlaceOrder', lang),
  };
}

function cartRemoveModeOptions(lang, t = defaultT, { allowEdit = true } = {}) {
  const opts = [
    { id: 'one', title: t('menuFlowRemoveOne', lang) },
    { id: 'line', title: t('menuFlowRemoveLine', lang) },
    { id: 'all', title: t('menuFlowRemoveAll', lang) },
  ];
  if (allowEdit) opts.push({ id: 'edit', title: t('menuFlowRemoveEdit', lang) });
  return opts;
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
    [F.UI_REVIEW_INTRO]: t('confirmFlowReviewIntro', lang),
    [F.UI_REVIEW_SECTION_BASKET]: t('confirmFlowReviewSectionBasket', lang),
    [F.UI_NAME_LABEL]: t('confirmFlowNameLabel', lang),
    [F.UI_NAME_EMPTY]: t('confirmFlowNameEmpty', lang),
    [F.UI_TYPE_LABEL]: t('confirmFlowTypeLabel', lang),
    [F.UI_ADDRESS_CHOICE_LABEL]: t('confirmFlowAddressChoiceLabel', lang),
    [F.UI_ADDRESS_LABEL]: t('confirmFlowAddressLabel', lang),
    [F.UI_ADDRESS_HELPER]: t('confirmFlowAddressHelper', lang),
    [F.UI_APARTMENT_LABEL]: t('confirmFlowApartmentLabel', lang),
    [F.UI_APARTMENT_HELPER]: t('confirmFlowApartmentHelper', lang),
    [F.UI_DELIVERY_ADDRESS_EMPTY]: t('confirmFlowAddressEmpty', lang),
    [F.UI_NOTE_LABEL]: t('confirmFlowNoteLabel', lang),
    [F.UI_BACK_TO_CART]: t('confirmFlowBackToCart', lang),
    [F.UI_PLACE_ORDER]: t('confirmFlowFooter', lang),
    [F.UI_MANAGE_ADDRESSES_LINK]: t('confirmFlowProfileLink', lang),
  };
}

function checkoutManageCopy(lang, t = defaultT, { savedCount = 0, maxSaved = DEFAULT_MAX_SAVED_ADDRESSES } = {}) {
  const n = Math.max(0, Number(savedCount) || 0);
  const max = Math.max(1, Number(maxSaved) || DEFAULT_MAX_SAVED_ADDRESSES);
  return {
    [F.UI_MANAGE_SCREEN_TITLE]: t('confirmFlowManageTitle', lang),
    [F.UI_MANAGE_HINT]: t('confirmFlowManageHint', lang, n, max),
    [F.UI_MANAGE_EDIT_CAPTION]: t('confirmFlowManageEditCaption', lang),
    [F.UI_MANAGE_SELECT_HINT]: t('confirmFlowManageSelectHint', lang),
    [F.UI_MANAGE_EDIT]: t('confirmFlowManageEdit', lang),
    [F.UI_MANAGE_SAVE]: t('confirmFlowManageSave', lang),
    [F.UI_MANAGE_SET_DEFAULT]: t('confirmFlowManageSetDefault', lang),
    [F.UI_MANAGE_DELETE]: t('confirmFlowManageDelete', lang),
    [F.UI_MANAGE_BACK]: t('confirmFlowManageBack', lang),
    [F.UI_MANAGE_CONFIRM_YES]: t('confirmFlowManageConfirmYes', lang),
    [F.UI_MANAGE_CONFIRM_EDIT]: t('confirmFlowManageConfirmEdit', lang),
    [F.UI_MANAGE_CONFIRM_TYPED]: t('confirmFlowManageConfirmTyped', lang),
    [F.UI_MANAGE_CONFIRM_FOUND]: t('confirmFlowManageConfirmFound', lang),
    [F.UI_PROFILE_NAME_LABEL]: t('confirmFlowProfileNameLabel', lang),
    [F.UI_PROFILE_NAME_HELPER]: t('confirmFlowProfileNameHelper', lang),
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
  cartRemoveModeOptions,
  cartDoneCopy,
  checkoutReviewCopy,
  checkoutManageCopy,
  clearCartTitle,
};
