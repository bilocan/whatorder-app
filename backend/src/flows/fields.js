// Single source of truth for WhatsApp Flow field names.
// Both generateFlow.js (JSON builder) and flow.js (exchange endpoint) import from here.
// If you rename a field, update it here — both sides stay in sync automatically.

const SCREENS = {
  CATEGORY_SELECT:        'CATEGORY_SELECT',
  CATEGORY_SELECT_RETURN: 'CATEGORY_SELECT_RETURN', // identical to CATEGORY_SELECT but routable from CART screens
  MENU_BROWSE:            'MENU_BROWSE',
  ORDER_ITEM:             'ORDER_ITEM',
  // Cart → edit clones (Meta forbids A↔B; forward-only like ADDRESS_MANAGE).
  ORDER_ITEM_EDIT:        'ORDER_ITEM_EDIT',
  ORDER_ITEM_EDIT_AGAIN:  'ORDER_ITEM_EDIT_AGAIN',
  CART_EDITED:            'CART_EDITED',
  CART_EDITED_AGAIN:      'CART_EDITED_AGAIN',
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
  ITEM_DESCRIPTION_VISIBLE: 'item_description_visible',
  ITEM_PRICE:       'item_price',
  ITEM_IMAGE:       'item_image',
  ITEM_IMAGE_VISIBLE: 'item_image_visible',
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
  BASKET_TEXT:    'basket_text',    // CART_DONE plain list; edit screens use CheckboxGroup rows
  SUBTOTAL_LABEL: 'subtotal_label',
  DISCOUNT_LABEL: 'discount_label',
  DISCOUNT_VISIBLE: 'discount_visible',
  DELIVERY_LABEL: 'delivery_label',
  DELIVERY_VISIBLE: 'delivery_visible',
  TOTAL_LABEL:    'total_label',
  BASKET_ITEMS:   'basket_items',
  REMOVE_ITEMS:   'remove_items', // CheckboxGroup — multi-select removal
  REMOVE_MODE:    'remove_mode',  // Radio: one | line
  REMOVE_MODE_OPTIONS: 'remove_mode_options',

  // Menu Flow UI copy (filled from session.language on every exchange)
  UI_SCREEN_TITLE:     'ui_screen_title',
  UI_CATEGORY_PROMPT:  'ui_category_prompt',
  UI_NEXT:             'ui_next',
  UI_CUSTOMISE:        'ui_customise',
  UI_QTY_LABEL:        'ui_qty_label',
  UI_QTY_HELPER:       'ui_qty_helper',
  FORM_INIT_VALUES:    'form_init_values',
  ERROR_MESSAGES:      'error_messages',
  UI_NOTES_LABEL:      'ui_notes_label',
  UI_NOTES_HELPER:     'ui_notes_helper',
  UI_ADD_TO_CART:      'ui_add_to_cart',
  // Footer payload: 'add_item' | 'back_to_cart' (model B: no EmbeddedLink on ORDER_ITEM).
  UI_ORDER_FOOTER_ACTION: 'ui_order_footer_action',
  UI_MULTI_TOGGLE:        'ui_multi_toggle',
  UI_MULTI_TOGGLE_VISIBLE: 'ui_multi_toggle_visible',
  UI_FOOTER_LEFT_CAPTION: 'ui_footer_left_caption',
  UI_CART_HINT:        'ui_cart_hint',
  UI_REMOVE_LABEL:     'ui_remove_label',
  UI_REMOVE_MODE_LABEL: 'ui_remove_mode_label',
  UI_REMOVE_SELECTED:  'ui_remove_selected',
  UI_ADD_MORE:         'ui_add_more',
  UI_PLACE_ORDER:      'ui_place_order',

  // CHECKOUT_REVIEW
  RECEIPT_TEXT:       'receipt_text',
  CUSTOMER_NAME:      'customer_name',
  CUSTOMER_NAME_DISPLAY: 'customer_name_display',
  ORDER_TYPE:         'order_type',
  ORDER_TYPE_OPTIONS: 'order_type_options',
  ADDRESS_CHOICE:     'address_choice',
  ADDRESS_OPTIONS:    'address_options',
  ADDRESS_FIELDS_VISIBLE: 'address_fields_visible',
  DELIVERY_ADDRESS:   'delivery_address',
  DELIVERY_APARTMENT: 'delivery_apartment',
  // Read-only summary on CHECKOUT_REVIEW (full label or empty-state copy).
  DELIVERY_ADDRESS_DISPLAY: 'delivery_address_display',
  DELIVERY_ADDRESS_BUILDING: 'delivery_address_building',
  DELIVERY_ADDRESS_UNIT: 'delivery_address_unit',
  DELIVERY_ADDRESS_LOCALITY: 'delivery_address_locality',
  DELIVERY_ADDRESS_UNIT_VISIBLE: 'delivery_address_unit_visible',
  REVIEW_PIN_IMAGE: 'review_pin_image',
  CHECKOUT_NOTE:      'note',
  UI_REVIEW_INTRO:    'ui_review_intro',
  UI_REVIEW_SECTION_BASKET: 'ui_review_section_basket',
  UI_NAME_LABEL:      'ui_name_label',
  UI_NAME_EMPTY:      'ui_name_empty',
  UI_PROFILE_NAME_LABEL: 'ui_profile_name_label',
  UI_PROFILE_NAME_HELPER: 'ui_profile_name_helper',
  UI_TYPE_LABEL:      'ui_type_label',
  UI_ADDRESS_CHOICE_LABEL: 'ui_address_choice_label',
  UI_ADDRESS_LABEL:   'ui_address_label',
  UI_ADDRESS_HELPER:  'ui_address_helper',
  UI_APARTMENT_LABEL: 'ui_apartment_label',
  UI_APARTMENT_HELPER: 'ui_apartment_helper',
  UI_DELIVERY_ADDRESS_EMPTY: 'ui_delivery_address_empty',
  UI_NOTE_LABEL:      'ui_note_label',
  UI_BACK_TO_CART:    'ui_back_to_cart',
  UI_BACK_TO_CART_VISIBLE: 'ui_back_to_cart_visible',
  UI_MANAGE_ADDRESSES_LINK: 'ui_manage_addresses_link',

  // ADDRESS_MANAGE
  MANAGE_ADDRESS_CHOICE:  'manage_address_choice',
  MANAGE_ADDRESS_OPTIONS: 'manage_address_options',
  // OptIn (not EmbeddedLink): Meta allows max 2 EmbeddedLinks per screen.
  MANAGE_SET_AS_DEFAULT:  'manage_set_as_default',
  UI_MANAGE_SCREEN_TITLE: 'ui_manage_screen_title',
  UI_MANAGE_HINT:         'ui_manage_hint',
  UI_MANAGE_EDIT_CAPTION: 'ui_manage_edit_caption',
  UI_MANAGE_SELECT_HINT:  'ui_manage_select_hint',
  UI_MANAGE_EDIT:         'ui_manage_edit',
  UI_MANAGE_SAVE:         'ui_manage_save',
  UI_MANAGE_SET_DEFAULT:  'ui_manage_set_default',
  UI_MANAGE_DELETE:       'ui_manage_delete',
  UI_MANAGE_BACK:         'ui_manage_back',
  UI_MANAGE_CONFIRM_YES:  'ui_manage_confirm_yes',
  UI_MANAGE_CONFIRM_EDIT: 'ui_manage_confirm_edit',
  UI_MANAGE_CONFIRM_TYPED: 'ui_manage_confirm_typed',
  UI_MANAGE_CONFIRM_FOUND: 'ui_manage_confirm_found',
  // 'list' | 'edit' | 'confirm' — string (not boolean): Meta If is unreliable with boolean false.
  MANAGE_UI_MODE:         'manage_ui_mode',
  // Normalized candidate shown on confirm; also echoed in accept payload if session is missing.
  MANAGE_CONFIRM_PENDING: 'manage_confirm_pending',
  MANAGE_CONFIRM_TYPED:   'manage_confirm_typed',
  MANAGE_CONFIRM_BUILDING: 'manage_confirm_building',
  MANAGE_CONFIRM_UNIT:    'manage_confirm_unit',
  MANAGE_CONFIRM_LOCALITY: 'manage_confirm_locality',
  MANAGE_CONFIRM_UNIT_VISIBLE: 'manage_confirm_unit_visible',
  MANAGE_CONFIRM_PIN_IMAGE: 'manage_confirm_pin_image',
  ERROR_MESSAGE:          'error_message',
  ERROR_VISIBLE:          'error_visible',
};

module.exports = { SCREENS, FIELDS };
