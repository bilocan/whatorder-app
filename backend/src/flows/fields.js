// Single source of truth for WhatsApp Flow field names.
// Both generateFlow.js (JSON builder) and flow.js (exchange endpoint) import from here.
// If you rename a field, update it here — both sides stay in sync automatically.

const SCREENS = {
  CATEGORY_SELECT: 'CATEGORY_SELECT',
  MENU_BROWSE:     'MENU_BROWSE',
  ORDER_ITEM:      'ORDER_ITEM',
  CART_REVIEW:     'CART_REVIEW',
};

const FIELDS = {
  // CATEGORY_SELECT
  CATEGORIES:    'categories',
  CATEGORY_ID:   'category_id',

  // MENU_BROWSE
  CATEGORY_TITLE: 'category_title',
  MENU_ITEMS:     'menu_items',
  ITEM_ID:        'item_id',

  // ORDER_ITEM
  ITEM_NAME:        'item_name',
  ITEM_DESCRIPTION: 'item_description',
  ITEM_PRICE:       'item_price',
  QTY_OPTIONS:      'qty_options',
  QTY:              'qty',
  SLOT1_VISIBLE:  'slot1_visible',
  SLOT1_LABEL:    'slot1_label',
  SLOT1_REQUIRED: 'slot1_required',
  SLOT1_OPTIONS:  'slot1_options',
  SLOT2_VISIBLE:  'slot2_visible',
  SLOT2_LABEL:    'slot2_label',
  SLOT2_REQUIRED: 'slot2_required',
  SLOT2_OPTIONS:  'slot2_options',
  SLOT3_VISIBLE:  'slot3_visible',
  SLOT3_LABEL:    'slot3_label',
  SLOT3_REQUIRED: 'slot3_required',
  SLOT3_OPTIONS:  'slot3_options',
  MULTI_VISIBLE:  'multi_visible',
  MULTI_LABEL:    'multi_label',
  MULTI_OPTIONS:  'multi_options',
  SLOT1_VALUE:    'slot1_value',
  SLOT2_VALUE:    'slot2_value',
  SLOT3_VALUE:    'slot3_value',
  MULTI_VALUE:    'multi_value',
  NOTES:          'notes',

  // CART_REVIEW
  BASKET_TEXT: 'basket_text',
  TOTAL_LABEL: 'total_label',
};

module.exports = { SCREENS, FIELDS };
