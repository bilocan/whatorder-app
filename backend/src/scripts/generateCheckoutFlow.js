#!/usr/bin/env node
// Generates backend/src/flows/checkout-flow.json from JS.
// Run: npm run generate:checkout-flow
// After running, upload the JSON to Meta (Flow Builder or uploadFlow.js).
//
// UI chrome is localized via ${data.ui_*} filled by /flow/exchange from session.language.

const fs = require('fs');
const path = require('path');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const { checkoutReviewCopy, checkoutManageCopy } = require('../bot/menuFlowCopy');
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

async function checkoutReviewScreen(id, { includeManageLink = true } = {}) {
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
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_BACK_TO_CART}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: { checkout_action: 'back_to_cart' },
            },
          },
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

async function main() {
  const exampleOptions = await exampleAddressOptions(EXAMPLE_LANG);
  const flow = {
    version: '7.3',
    data_api_version: '3.0',
    routing_model: {
      [S.CHECKOUT_REVIEW]: [S.ADDRESS_MANAGE],
      [S.ADDRESS_MANAGE]: [S.ADDRESS_MANAGE_UPDATED, S.CHECKOUT_REVIEW_RETURN],
      [S.ADDRESS_MANAGE_UPDATED]: [S.CHECKOUT_REVIEW_RETURN],
      [S.CHECKOUT_REVIEW_RETURN]: [S.ADDRESS_MANAGE_AGAIN],
      [S.ADDRESS_MANAGE_AGAIN]: [S.CHECKOUT_REVIEW_DONE],
      [S.CHECKOUT_REVIEW_DONE]: [],
    },
    screens: [
      await checkoutReviewScreen(S.CHECKOUT_REVIEW),
      await addressManageScreen(S.ADDRESS_MANAGE, exampleOptions),
      await addressManageScreen(S.ADDRESS_MANAGE_UPDATED, exampleOptions),
      await checkoutReviewScreen(S.CHECKOUT_REVIEW_RETURN),
      await addressManageScreen(S.ADDRESS_MANAGE_AGAIN, exampleOptions),
      await checkoutReviewScreen(S.CHECKOUT_REVIEW_DONE, { includeManageLink: true }),
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(flow, null, 2));
  console.log(`Written → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
