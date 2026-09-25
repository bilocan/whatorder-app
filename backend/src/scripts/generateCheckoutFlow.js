#!/usr/bin/env node
// Generates backend/src/flows/checkout-flow.json from JS.
// Run: npm run generate:checkout-flow
// After running, upload the JSON to Meta (Flow Builder or uploadFlow.js).
//
// UI chrome is localized via ${data.ui_*} filled by /flow/exchange from session.language.

const fs = require('fs');
const path = require('path');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const { checkoutReviewCopy, checkoutManageCopy, checkoutCartCopy, cartRemoveModeOptions } = require('../bot/menuFlowCopy');
const { ADDRESS_CHOICE_NEW } = require('../bot/checkoutConfirmFlow');
const { t } = require('../lib/templates');
const { addressHomeIconBase64, addressNewIconBase64 } = require('../lib/flowImages');

const OUT = path.join(__dirname, '../flows/checkout-flow.json');
const EXAMPLE_LANG = 'en';

const OPTION_LIST_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      metadata: { type: 'string' },
    },
  },
};

const ADDRESS_OPTION_LIST_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      metadata: { type: 'string' },
      image: { type: 'string' },
      'alt-text': { type: 'string' },
    },
  },
};

function strField(example) {
  return { type: 'string', '__example__': example };
}

function uiSchema(copy) {
  return Object.fromEntries(
    Object.entries(copy).map(([key, value]) => [key, strField(value)]),
  );
}

async function withAddressIcon(opt) {
  const image = opt.id === ADDRESS_CHOICE_NEW
    ? await addressNewIconBase64()
    : await addressHomeIconBase64();
  return {
    ...opt,
    image,
    'alt-text': opt.title || opt.id,
  };
}

/** Example rows for Meta Flow Builder / Tester (slice 1 visual). */
async function exampleAddressOptions(lang) {
  const rows = [
    {
      id: 'addr_0',
      title: 'Hippgasse 11',
      description: 'Top 14 · 1160 Wien',
      metadata: '★',
    },
    {
      id: 'addr_1',
      title: 'Naschmarkt 5',
      description: '1040 Wien',
    },
    {
      id: ADDRESS_CHOICE_NEW,
      title: t('confirmFlowAddressNew', lang),
      description: t('confirmFlowAddressNewDesc', lang),
    },
  ];
  return Promise.all(rows.map(withAddressIcon));
}

/** Payload for review nav / place: name + address come from server data (read-only on Prüfen). */
function reviewFormPayload() {
  return {
    [F.CUSTOMER_NAME]: `\${data.${F.CUSTOMER_NAME}}`,
    [F.ORDER_TYPE]: `\${form.${F.ORDER_TYPE}}`,
    [F.ADDRESS_CHOICE]: `\${data.${F.ADDRESS_CHOICE}}`,
    [F.DELIVERY_ADDRESS]: `\${data.${F.DELIVERY_ADDRESS}}`,
    [F.DELIVERY_APARTMENT]: `\${data.${F.DELIVERY_APARTMENT}}`,
    [F.CHECKOUT_NOTE]: `\${form.${F.CHECKOUT_NOTE}}`,
  };
}

/** Delivery block on Prüfen: read-only full label (profile link lives outside). */
function deliveryAddressFields() {
  return [
    {
      type: 'TextCaption',
      text: `\${data.${F.UI_ADDRESS_CHOICE_LABEL}}`,
    },
    {
      type: 'TextBody',
      text: `\${data.${F.DELIVERY_ADDRESS_DISPLAY}}`,
    },
  ];
}

async function checkoutReviewScreen(id, { includeManageLink = true, includeCartLink = true } = {}) {
  const copy = checkoutReviewCopy(EXAMPLE_LANG);
  if (!includeManageLink) delete copy[F.UI_MANAGE_ADDRESSES_LINK];
  return {
    id,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    terminal: true,
    data: {
      ...uiSchema(copy),
      [F.RECEIPT_TEXT]: {
        type: 'string',
        '__example__': '1x Chicken Dürüm  €8.50\n1x Falafel Box  €6.90\n\nTotal: €15.40',
      },
      [F.CUSTOMER_NAME]: { type: 'string', '__example__': 'Alex Smith' },
      [F.CUSTOMER_NAME_DISPLAY]: { type: 'string', '__example__': 'Alex Smith' },
      [F.ORDER_TYPE]: { type: 'string', '__example__': 'delivery' },
      [F.ORDER_TYPE_OPTIONS]: {
        ...OPTION_LIST_SCHEMA,
        '__example__': [
          { id: 'pickup', title: 'Pickup' },
          { id: 'delivery', title: 'Delivery' },
        ],
      },
      [F.ADDRESS_CHOICE]: { type: 'string', '__example__': 'addr_0' },
      // Live exchange still sends this on CHECKOUT_REVIEW. Undeclared keys make the Flow fail to open.
      [F.ADDRESS_OPTIONS]: {
        ...OPTION_LIST_SCHEMA,
        '__example__': [
          { id: 'addr_0', title: 'Hippgasse 11', description: 'Top 14 · 1160 Wien', metadata: '★' },
          { id: 'addr_new', title: 'New address', description: 'Type a different address' },
        ],
      },
      [F.ADDRESS_FIELDS_VISIBLE]: { type: 'boolean', '__example__': true },
      [F.DELIVERY_ADDRESS]: { type: 'string', '__example__': 'Hippgasse 11, Top 14, 1160 Wien' },
      [F.DELIVERY_APARTMENT]: { type: 'string', '__example__': 'Top 14' },
      [F.DELIVERY_ADDRESS_DISPLAY]: {
        type: 'string',
        '__example__': 'Hippgasse 11, Top 14, 1160 Wien',
      },
      [F.CHECKOUT_NOTE]: { type: 'string', '__example__': 'Please ring the bell.' },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'checkout_form',
        'init-values': {
          [F.ORDER_TYPE]: `\${data.${F.ORDER_TYPE}}`,
          [F.CHECKOUT_NOTE]: `\${data.${F.CHECKOUT_NOTE}}`,
        },
        children: [
          {
            type: 'TextCaption',
            text: `\${data.${F.UI_REVIEW_INTRO}}`,
          },
          {
            type: 'TextCaption',
            text: `\${data.${F.UI_REVIEW_SECTION_BASKET}}`,
          },
          {
            type: 'TextBody',
            text: `\${data.${F.RECEIPT_TEXT}}`,
          },
          {
            type: 'TextCaption',
            text: `\${data.${F.UI_NAME_LABEL}}`,
          },
          {
            type: 'TextBody',
            text: `\${data.${F.CUSTOMER_NAME_DISPLAY}}`,
          },
          {
            type: 'RadioButtonsGroup',
            label: `\${data.${F.UI_TYPE_LABEL}}`,
            name: F.ORDER_TYPE,
            required: true,
            'data-source': `\${data.${F.ORDER_TYPE_OPTIONS}}`,
            'on-select-action': {
              name: 'data_exchange',
              payload: {
                checkout_action: 'select_order_type',
                ...reviewFormPayload(),
              },
            },
          },
          {
            type: 'If',
            condition: `\${form.${F.ORDER_TYPE}} == 'delivery'`,
            then: deliveryAddressFields(),
          },
          {
            type: 'TextArea',
            label: `\${data.${F.UI_NOTE_LABEL}}`,
            name: F.CHECKOUT_NOTE,
            required: false,
          },
          ...(includeManageLink ? [{
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_MANAGE_ADDRESSES_LINK}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: {
                checkout_action: 'manage_addresses',
                ...reviewFormPayload(),
              },
            },
          }] : []),
          ...(includeCartLink ? [{
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_BACK_TO_CART}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: {
                checkout_action: 'open_cart',
                ...reviewFormPayload(),
              },
            },
          }] : []),
          {
            type: 'Footer',
            label: `\${data.${F.UI_PLACE_ORDER}}`,
            'on-click-action': {
              name: 'complete',
              payload: {
                checkout_action: 'place_order',
                ...reviewFormPayload(),
              },
            },
          },
        ],
      }],
    },
  };
}

async function addressManageScreen(id, exampleOptions) {
  const copy = {
    ...checkoutReviewCopy(EXAMPLE_LANG),
    ...checkoutManageCopy(EXAMPLE_LANG, t, { savedCount: 2 }),
  };
  const formPayload = {
    [F.CUSTOMER_NAME]: `\${form.${F.CUSTOMER_NAME}}`,
    [F.MANAGE_ADDRESS_CHOICE]: `\${form.${F.MANAGE_ADDRESS_CHOICE}}`,
    [F.DELIVERY_ADDRESS]: `\${form.${F.DELIVERY_ADDRESS}}`,
    [F.DELIVERY_APARTMENT]: `\${form.${F.DELIVERY_APARTMENT}}`,
    [F.MANAGE_SET_AS_DEFAULT]: `\${form.${F.MANAGE_SET_AS_DEFAULT}}`,
  };

  return {
    id,
    title: `\${data.${F.UI_MANAGE_SCREEN_TITLE}}`,
    data: {
      ...uiSchema(copy),
      [F.CUSTOMER_NAME]: { type: 'string', '__example__': 'Alex' },
      [F.MANAGE_ADDRESS_CHOICE]: { type: 'string', '__example__': '' },
      [F.MANAGE_ADDRESS_OPTIONS]: {
        ...ADDRESS_OPTION_LIST_SCHEMA,
        '__example__': exampleOptions,
      },
      [F.DELIVERY_ADDRESS]: { type: 'string', '__example__': 'Hippgasse 11, 1160 Wien' },
      [F.DELIVERY_APARTMENT]: { type: 'string', '__example__': 'Top 14' },
      [F.MANAGE_UI_MODE]: { type: 'string', '__example__': 'list' },
      [F.MANAGE_CONFIRM_PENDING]: { type: 'string', '__example__': '' },
      [F.MANAGE_CONFIRM_TYPED]: { type: 'string', '__example__': '' },
      [F.MANAGE_CONFIRM_BUILDING]: { type: 'string', '__example__': 'Hippgasse 11' },
      [F.MANAGE_CONFIRM_UNIT]: { type: 'string', '__example__': 'Top 14' },
      [F.MANAGE_CONFIRM_LOCALITY]: { type: 'string', '__example__': '1160 Wien' },
      [F.MANAGE_CONFIRM_UNIT_VISIBLE]: { type: 'boolean', '__example__': false },
      [F.MANAGE_CONFIRM_PIN_IMAGE]: {
        type: 'string',
        '__example__': await addressHomeIconBase64(),
      },
      // Manage writes answer on the same screen, so the failure reason needs a visible slot.
      [F.ERROR_MESSAGE]: { type: 'string', '__example__': 'Select a saved address first.' },
      [F.ERROR_VISIBLE]: { type: 'boolean', '__example__': false },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'manage_address_form',
        'init-values': {
          [F.CUSTOMER_NAME]: `\${data.${F.CUSTOMER_NAME}}`,
          [F.MANAGE_ADDRESS_CHOICE]: `\${data.${F.MANAGE_ADDRESS_CHOICE}}`,
          [F.DELIVERY_ADDRESS]: `\${data.${F.DELIVERY_ADDRESS}}`,
          [F.DELIVERY_APARTMENT]: `\${data.${F.DELIVERY_APARTMENT}}`,
          [F.MANAGE_SET_AS_DEFAULT]: false,
        },
        children: [
          {
            type: 'TextCaption',
            text: `\${data.${F.ERROR_MESSAGE}}`,
            visible: `\${data.${F.ERROR_VISIBLE}}`,
          },
          {
            // Meta: Footer inside If must exist in both then and else; no Footer outside.
            type: 'If',
            condition: `\${data.${F.MANAGE_UI_MODE}} == 'confirm'`,
            then: [
              {
                type: 'TextBody',
                text: `\${data.${F.UI_MANAGE_HINT}}`,
              },
              {
                type: 'Image',
                src: `\${data.${F.MANAGE_CONFIRM_PIN_IMAGE}}`,
                width: 64,
                height: 64,
                'scale-type': 'contain',
              },
              {
                type: 'TextCaption',
                text: `\${data.${F.UI_MANAGE_CONFIRM_TYPED}}`,
              },
              {
                type: 'TextBody',
                text: `\${data.${F.MANAGE_CONFIRM_TYPED}}`,
              },
              {
                type: 'TextCaption',
                text: `\${data.${F.UI_MANAGE_CONFIRM_FOUND}}`,
              },
              {
                type: 'TextHeading',
                text: `\${data.${F.MANAGE_CONFIRM_BUILDING}}`,
              },
              {
                type: 'TextBody',
                text: `\${data.${F.MANAGE_CONFIRM_UNIT}}`,
                visible: `\${data.${F.MANAGE_CONFIRM_UNIT_VISIBLE}}`,
              },
              {
                type: 'TextCaption',
                text: `\${data.${F.MANAGE_CONFIRM_LOCALITY}}`,
              },
              {
                type: 'EmbeddedLink',
                text: `\${data.${F.UI_MANAGE_CONFIRM_EDIT}}`,
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    checkout_action: 'manage_confirm_reject',
                    [F.CUSTOMER_NAME]: `\${data.${F.CUSTOMER_NAME}}`,
                    [F.MANAGE_ADDRESS_CHOICE]: `\${form.${F.MANAGE_ADDRESS_CHOICE}}`,
                    [F.DELIVERY_ADDRESS]: `\${form.${F.DELIVERY_ADDRESS}}`,
                    [F.DELIVERY_APARTMENT]: `\${form.${F.DELIVERY_APARTMENT}}`,
                  },
                },
              },
              {
                type: 'Footer',
                label: `\${data.${F.UI_MANAGE_CONFIRM_YES}}`,
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    checkout_action: 'manage_confirm_accept',
                    [F.CUSTOMER_NAME]: `\${data.${F.CUSTOMER_NAME}}`,
                    [F.MANAGE_CONFIRM_PENDING]: `\${data.${F.MANAGE_CONFIRM_PENDING}}`,
                    [F.MANAGE_ADDRESS_CHOICE]: `\${form.${F.MANAGE_ADDRESS_CHOICE}}`,
                    [F.MANAGE_SET_AS_DEFAULT]: `\${form.${F.MANAGE_SET_AS_DEFAULT}}`,
                  },
                },
              },
            ],
            else: [
              {
                type: 'TextInput',
                label: `\${data.${F.UI_PROFILE_NAME_LABEL}}`,
                name: F.CUSTOMER_NAME,
                required: true,
                'helper-text': `\${data.${F.UI_PROFILE_NAME_HELPER}}`,
              },
              {
                type: 'RadioButtonsGroup',
                label: `\${data.${F.UI_MANAGE_HINT}}`,
                name: F.MANAGE_ADDRESS_CHOICE,
                // Not required: list opens with no selection; Footer "back" must stay tappable.
                required: false,
                'data-source': `\${data.${F.MANAGE_ADDRESS_OPTIONS}}`,
                'media-size': 'regular',
                'on-select-action': {
                  name: 'data_exchange',
                  payload: {
                    checkout_action: 'select_address',
                    [F.MANAGE_ADDRESS_CHOICE]: `\${form.${F.MANAGE_ADDRESS_CHOICE}}`,
                    [F.MANAGE_SET_AS_DEFAULT]: `\${form.${F.MANAGE_SET_AS_DEFAULT}}`,
                  },
                },
              },
              {
                type: 'If',
                condition: `\${data.${F.MANAGE_UI_MODE}} == 'edit'`,
                then: [
                  {
                    type: 'TextCaption',
                    text: `\${data.${F.UI_MANAGE_EDIT_CAPTION}}`,
                  },
                  {
                    type: 'TextInput',
                    label: `\${data.${F.UI_ADDRESS_LABEL}}`,
                    name: F.DELIVERY_ADDRESS,
                    required: true,
                    'helper-text': `\${data.${F.UI_ADDRESS_HELPER}}`,
                  },
                  {
                    type: 'TextInput',
                    label: `\${data.${F.UI_APARTMENT_LABEL}}`,
                    name: F.DELIVERY_APARTMENT,
                    required: true,
                    'helper-text': `\${data.${F.UI_APARTMENT_HELPER}}`,
                  },
                  {
                    type: 'OptIn',
                    label: `\${data.${F.UI_MANAGE_SET_DEFAULT}}`,
                    name: F.MANAGE_SET_AS_DEFAULT,
                    required: false,
                  },
                  {
                    type: 'If',
                    condition: `\${form.${F.MANAGE_ADDRESS_CHOICE}} != '${ADDRESS_CHOICE_NEW}'`,
                    then: [{
                      type: 'EmbeddedLink',
                      text: `\${data.${F.UI_MANAGE_DELETE}}`,
                      'on-click-action': {
                        name: 'data_exchange',
                        payload: {
                          checkout_action: 'manage_delete',
                          ...formPayload,
                        },
                      },
                    }],
                  },
                  {
                    type: 'EmbeddedLink',
                    text: `\${data.${F.UI_MANAGE_BACK}}`,
                    'on-click-action': {
                      name: 'data_exchange',
                      payload: {
                        checkout_action: 'manage_back',
                        ...formPayload,
                      },
                    },
                  },
                  {
                    type: 'Footer',
                    label: `\${data.${F.UI_MANAGE_SAVE}}`,
                    'on-click-action': {
                      name: 'data_exchange',
                      payload: {
                        checkout_action: 'manage_save',
                        ...formPayload,
                      },
                    },
                  },
                ],
                else: [
                  {
                    type: 'TextCaption',
                    text: `\${data.${F.UI_MANAGE_SELECT_HINT}}`,
                  },
                  {
                    // List mode: primary action is return (tap a row to open the form).
                    // Include name so Profil edits persist on Siparişe dön.
                    type: 'Footer',
                    label: `\${data.${F.UI_MANAGE_BACK}}`,
                    'on-click-action': {
                      name: 'data_exchange',
                      payload: {
                        checkout_action: 'manage_back',
                        ...formPayload,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }],
    },
  };
}

const CART_OPTION_PROPS = {
  id: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  metadata: { type: 'string' },
  image: { type: 'string' },
  'alt-text': { type: 'string' },
};

/** Same remove UI as the menu cart. Footer returns to the next Prüfen clone. No Bearbeiten. */
function checkoutCartScreen(id) {
  const copy = checkoutCartCopy(EXAMPLE_LANG, t);
  return {
    id,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    refresh_on_back: true,
    data: {
      ...uiSchema(copy),
      [F.SUBTOTAL_LABEL]: { type: 'string', '__example__': 'Subtotal: €15.40' },
      [F.DISCOUNT_LABEL]: { type: 'string', '__example__': '' },
      [F.DISCOUNT_VISIBLE]: { type: 'boolean', '__example__': false },
      [F.DELIVERY_LABEL]: { type: 'string', '__example__': '' },
      [F.DELIVERY_VISIBLE]: { type: 'boolean', '__example__': false },
      [F.TOTAL_LABEL]: { type: 'string', '__example__': 'Total: €15.40' },
      [F.BASKET_ITEMS]: {
        type: 'array',
        items: { type: 'object', properties: CART_OPTION_PROPS },
        '__example__': [
          {
            id: '0',
            title: '1x Dürüm Huhn',
            description: 'Tomaten, Salat',
            metadata: '€8.50',
            image: 'AA==',
            'alt-text': '1x Dürüm Huhn',
          },
        ],
      },
      [F.REMOVE_MODE_OPTIONS]: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
        '__example__': cartRemoveModeOptions(EXAMPLE_LANG, t, { allowEdit: false }),
      },
      [F.FORM_INIT_VALUES]: {
        type: 'object',
        properties: { [F.REMOVE_MODE]: { type: 'string' } },
        '__example__': { [F.REMOVE_MODE]: 'one' },
      },
      [F.ERROR_MESSAGE]: { type: 'string', '__example__': '' },
      [F.ERROR_VISIBLE]: { type: 'boolean', '__example__': false },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'checkout_cart_form',
        'init-values': `\${data.${F.FORM_INIT_VALUES}}`,
        children: [
          { type: 'TextCaption', text: `\${data.${F.UI_CART_HINT}}` },
          {
            type: 'TextBody',
            text: `\${data.${F.ERROR_MESSAGE}}`,
            visible: `\${data.${F.ERROR_VISIBLE}}`,
          },
          {
            type: 'CheckboxGroup',
            label: `\${data.${F.UI_REMOVE_LABEL}}`,
            name: F.REMOVE_ITEMS,
            required: false,
            'media-size': 'large',
            'data-source': `\${data.${F.BASKET_ITEMS}}`,
          },
          { type: 'TextBody', text: `\${data.${F.SUBTOTAL_LABEL}}` },
          {
            type: 'If',
            condition: `\${data.${F.DISCOUNT_VISIBLE}}`,
            then: [{ type: 'TextBody', text: `\${data.${F.DISCOUNT_LABEL}}` }],
          },
          {
            type: 'If',
            condition: `\${data.${F.DELIVERY_VISIBLE}}`,
            then: [{ type: 'TextBody', text: `\${data.${F.DELIVERY_LABEL}}` }],
          },
          { type: 'TextSubheading', text: `\${data.${F.TOTAL_LABEL}}` },
          {
            type: 'RadioButtonsGroup',
            label: `\${data.${F.UI_REMOVE_MODE_LABEL}}`,
            name: F.REMOVE_MODE,
            required: true,
            'data-source': `\${data.${F.REMOVE_MODE_OPTIONS}}`,
          },
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_REMOVE_SELECTED}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: {
                checkout_action: 'cart_remove',
                [F.REMOVE_ITEMS]: `\${form.${F.REMOVE_ITEMS}}`,
                [F.REMOVE_MODE]: `\${form.${F.REMOVE_MODE}}`,
              },
            },
          },
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_ADD_MORE}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: { checkout_action: 'add_more' },
            },
          },
          {
            type: 'Footer',
            label: `\${data.${F.UI_RETURN_TO_REVIEW}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: { checkout_action: 'return_to_review' },
            },
          },
        ],
      }],
    },
  };
}

async function main() {
  const exampleOptions = await exampleAddressOptions(EXAMPLE_LANG);
  const flow = {
    version: '7.3',
    data_api_version: '3.0',
    routing_model: {
      [S.CHECKOUT_REVIEW]: [S.ADDRESS_MANAGE, S.CHECKOUT_CART],
      [S.ADDRESS_MANAGE]: [S.ADDRESS_MANAGE_UPDATED, S.CHECKOUT_REVIEW_RETURN],
      [S.ADDRESS_MANAGE_UPDATED]: [S.CHECKOUT_REVIEW_RETURN],
      [S.CHECKOUT_CART]: [S.CHECKOUT_REVIEW_RETURN],
      [S.CHECKOUT_REVIEW_RETURN]: [S.ADDRESS_MANAGE_AGAIN, S.CHECKOUT_CART_AGAIN],
      [S.CHECKOUT_CART_AGAIN]: [S.CHECKOUT_REVIEW_DONE],
      [S.ADDRESS_MANAGE_AGAIN]: [S.CHECKOUT_REVIEW_DONE],
      [S.CHECKOUT_REVIEW_DONE]: [],
    },
    screens: [
      await checkoutReviewScreen(S.CHECKOUT_REVIEW),
      checkoutCartScreen(S.CHECKOUT_CART),
      await addressManageScreen(S.ADDRESS_MANAGE, exampleOptions),
      await addressManageScreen(S.ADDRESS_MANAGE_UPDATED, exampleOptions),
      await checkoutReviewScreen(S.CHECKOUT_REVIEW_RETURN),
      checkoutCartScreen(S.CHECKOUT_CART_AGAIN),
      await addressManageScreen(S.ADDRESS_MANAGE_AGAIN, exampleOptions),
      await checkoutReviewScreen(S.CHECKOUT_REVIEW_DONE, {
        includeManageLink: true,
        includeCartLink: false,
      }),
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(flow, null, 2));
  console.log(`Written → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
