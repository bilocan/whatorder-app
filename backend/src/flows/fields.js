// Single source of truth for WhatsApp Flow field names.
// Both generateFlow.js (JSON builder) and flow.js (exchange endpoint) import from here.
// If you rename a field, update it here — both sides stay in sync automatically.

const SCREENS = {
  CATEGORY_SELECT:        'CATEGORY_SELECT',
  CATEGORY_SELECT_RETURN: 'CATEGORY_SELECT_RETURN', // identical to CATEGORY_SELECT but routable from CART screens
  MENU_BROWSE:            'MENU_BROWSE',
  ORDER_ITEM:             'ORDER_ITEM',
  CART_REVIEW:  'CART_REVIEW',  // editable cart round 1
  CART_UPDATED: 'CART_UPDATED', // editable cart round 2 (identical UI, different ID to satisfy DAG)
  CART_DONE:    'CART_DONE',    // final summary — no remove UI, just place order
  CHECKOUT_REVIEW: 'CHECKOUT_REVIEW',
  CHECKOUT_REVIEW_RETURN: 'CHECKOUT_REVIEW_RETURN',
  // Meta screen ids: letters + underscores only (no digits). Mirrors CART_DONE.
  CHECKOUT_REVIEW_DONE: 'CHECKOUT_REVIEW_DONE',
  ADDRESS_MANAGE: 'ADDRESS_MANAGE',
  ADDRESS_MANAGE_UPDATED: 'ADDRESS_MANAGE_UPDATED',
  ADDRESS_MANAGE_AGAIN: 'ADDRESS_MANAGE_AGAIN',
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
  BASKET_TEXT:  'basket_text',
  TOTAL_LABEL:  'total_label',
  BASKET_ITEMS: 'basket_items',
  REMOVE_ITEMS: 'remove_items', // CheckboxGroup — multi-select removal

  // Menu Flow UI copy (filled from session.language on every exchange)
  UI_SCREEN_TITLE:     'ui_screen_title',
  UI_CATEGORY_PROMPT:  'ui_category_prompt',
  UI_NEXT:             'ui_next',
  UI_CUSTOMISE:        'ui_customise',
  UI_QTY_LABEL:        'ui_qty_label',
  UI_NOTES_LABEL:      'ui_notes_label',
  UI_NOTES_HELPER:     'ui_notes_helper',
  UI_ADD_TO_CART:      'ui_add_to_cart',
  UI_CART_HINT:        'ui_cart_hint',
  UI_REMOVE_LABEL:     'ui_remove_label',
  UI_REMOVE_SELECTED:  'ui_remove_selected',
  UI_ADD_MORE:         'ui_add_more',
  UI_PLACE_ORDER:      'ui_place_order',

  // CHECKOUT_REVIEW
  RECEIPT_TEXT:       'receipt_text',
  CUSTOMER_NAME:      'customer_name',
  ORDER_TYPE:         'order_type',
  ORDER_TYPE_OPTIONS: 'order_type_options',
  ADDRESS_CHOICE:     'address_choice',
  ADDRESS_OPTIONS:    'address_options',
  DELIVERY_ADDRESS:   'delivery_address',
  DELIVERY_APARTMENT: 'delivery_apartment',
  CHECKOUT_NOTE:      'note',
  UI_NAME_LABEL:      'ui_name_label',
  UI_TYPE_LABEL:      'ui_type_label',
  UI_ADDRESS_CHOICE_LABEL: 'ui_address_choice_label',
  UI_ADDRESS_LABEL:   'ui_address_label',
  UI_APARTMENT_LABEL: 'ui_apartment_label',
  UI_APARTMENT_HELPER: 'ui_apartment_helper',
  UI_NOTE_LABEL:      'ui_note_label',
  UI_BACK_TO_CART:    'ui_back_to_cart',
  UI_MANAGE_ADDRESSES_LINK: 'ui_manage_addresses_link',

  // ADDRESS_MANAGE
  MANAGE_ADDRESS_CHOICE:  'manage_address_choice',
  MANAGE_ADDRESS_OPTIONS: 'manage_address_options',
  // OptIn (not EmbeddedLink): Meta allows max 2 EmbeddedLinks per screen.
  MANAGE_SET_AS_DEFAULT:  'manage_set_as_default',
  UI_MANAGE_SCREEN_TITLE: 'ui_manage_screen_title',
  UI_MANAGE_HINT:         'ui_manage_hint',
  UI_MANAGE_SAVE:         'ui_manage_save',
  UI_MANAGE_SET_DEFAULT:  'ui_manage_set_default',
  UI_MANAGE_DELETE:       'ui_manage_delete',
  UI_MANAGE_BACK:         'ui_manage_back',
  ERROR_MESSAGE:          'error_message',
  ERROR_VISIBLE:          'error_visible',
};

module.exports = { SCREENS, FIELDS };
