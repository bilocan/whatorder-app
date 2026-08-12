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
const { t } = require('../lib/templates');

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

function strField(example) {
  return { type: 'string', '__example__': example };
}

function uiSchema(copy) {
  return Object.fromEntries(
    Object.entries(copy).map(([key, value]) => [key, strField(value)]),
  );
}

/** Example rows for Meta Flow Builder / Tester (slice 1 visual). */
function exampleAddressOptions(lang) {
  return [
    {
      id: 'addr_0',
      title: 'Hippgasse 11',
      description: 'Top 14, 1160 Wien',
    },
    {
      id: 'addr_1',
      title: 'Naschmarkt 5',
      description: '1040 Wien',
    },
    {
      id: 'addr_new',
      title: t('confirmFlowAddressNew', lang),
      description: t('confirmFlowAddressNewDesc', lang),
    },
  ];
}

function checkoutReviewScreen(id, { includeManageLink = true } = {}) {
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
      [F.ORDER_TYPE]: { type: 'string', '__example__': 'delivery' },
      [F.ORDER_TYPE_OPTIONS]: {
        ...OPTION_LIST_SCHEMA,
        '__example__': [
          { id: 'pickup', title: 'Pickup' },
          { id: 'delivery', title: 'Delivery' },
        ],
      },
      [F.ADDRESS_CHOICE]: { type: 'string', '__example__': 'addr_0' },
      [F.ADDRESS_OPTIONS]: {
        ...OPTION_LIST_SCHEMA,
        '__example__': exampleAddressOptions(EXAMPLE_LANG),
      },
      [F.DELIVERY_ADDRESS]: { type: 'string', '__example__': 'Hippgasse 11, 1160 Wien' },
      [F.DELIVERY_APARTMENT]: { type: 'string', '__example__': 'Top 14' },
      [F.CHECKOUT_NOTE]: { type: 'string', '__example__': 'Please ring the bell.' },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'checkout_form',
        // Prefill belongs on Form (init-value is only valid outside Form).
        'init-values': {
          [F.CUSTOMER_NAME]: `\${data.${F.CUSTOMER_NAME}}`,
          [F.ORDER_TYPE]: `\${data.${F.ORDER_TYPE}}`,
          [F.ADDRESS_CHOICE]: `\${data.${F.ADDRESS_CHOICE}}`,
          [F.DELIVERY_ADDRESS]: `\${data.${F.DELIVERY_ADDRESS}}`,
          [F.DELIVERY_APARTMENT]: `\${data.${F.DELIVERY_APARTMENT}}`,
          [F.CHECKOUT_NOTE]: `\${data.${F.CHECKOUT_NOTE}}`,
        },
        children: [
          {
            type: 'TextBody',
            text: `\${data.${F.RECEIPT_TEXT}}`,
          },
          {
            type: 'TextInput',
            label: `\${data.${F.UI_NAME_LABEL}}`,
            name: F.CUSTOMER_NAME,
            required: true,
          },
          {
            type: 'RadioButtonsGroup',
            label: `\${data.${F.UI_TYPE_LABEL}}`,
            name: F.ORDER_TYPE,
            required: true,
            'data-source': `\${data.${F.ORDER_TYPE_OPTIONS}}`,
          },
          {
            type: 'RadioButtonsGroup',
            label: `\${data.${F.UI_ADDRESS_CHOICE_LABEL}}`,
            name: F.ADDRESS_CHOICE,
            required: true,
            'data-source': `\${data.${F.ADDRESS_OPTIONS}}`,
            'on-select-action': {
              name: 'data_exchange',
              payload: {
                checkout_action: 'select_address',
                [F.CUSTOMER_NAME]: `\${form.${F.CUSTOMER_NAME}}`,
                [F.ORDER_TYPE]: `\${form.${F.ORDER_TYPE}}`,
                [F.ADDRESS_CHOICE]: `\${form.${F.ADDRESS_CHOICE}}`,
                [F.DELIVERY_ADDRESS]: `\${form.${F.DELIVERY_ADDRESS}}`,
                [F.DELIVERY_APARTMENT]: `\${form.${F.DELIVERY_APARTMENT}}`,
                [F.CHECKOUT_NOTE]: `\${form.${F.CHECKOUT_NOTE}}`,
              },
            },
          },
          {
            type: 'TextInput',
            label: `\${data.${F.UI_ADDRESS_LABEL}}`,
            name: F.DELIVERY_ADDRESS,
            required: true,
          },
          {
            type: 'TextInput',
            label: `\${data.${F.UI_APARTMENT_LABEL}}`,
            name: F.DELIVERY_APARTMENT,
            required: true,
            'helper-text': `\${data.${F.UI_APARTMENT_HELPER}}`,
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
                [F.CUSTOMER_NAME]: `\${form.${F.CUSTOMER_NAME}}`,
                [F.ORDER_TYPE]: `\${form.${F.ORDER_TYPE}}`,
                [F.ADDRESS_CHOICE]: `\${form.${F.ADDRESS_CHOICE}}`,
                [F.DELIVERY_ADDRESS]: `\${form.${F.DELIVERY_ADDRESS}}`,
                [F.DELIVERY_APARTMENT]: `\${form.${F.DELIVERY_APARTMENT}}`,
                [F.CHECKOUT_NOTE]: `\${form.${F.CHECKOUT_NOTE}}`,
              },
            },
          }] : []),
          {
            // EmbeddedLink cannot use `complete` — only data_exchange / navigate / open_url.
            // Endpoint closes the Flow with SUCCESS + checkout_action for nfm_reply.
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
                [F.CUSTOMER_NAME]: `\${form.${F.CUSTOMER_NAME}}`,
                [F.ORDER_TYPE]: `\${form.${F.ORDER_TYPE}}`,
                [F.ADDRESS_CHOICE]: `\${form.${F.ADDRESS_CHOICE}}`,
                [F.DELIVERY_ADDRESS]: `\${form.${F.DELIVERY_ADDRESS}}`,
                [F.DELIVERY_APARTMENT]: `\${form.${F.DELIVERY_APARTMENT}}`,
                [F.CHECKOUT_NOTE]: `\${form.${F.CHECKOUT_NOTE}}`,
              },
            },
          },
        ],
      }],
    },
  };
}

function addressManageScreen(id) {
  const copy = {
    ...checkoutReviewCopy(EXAMPLE_LANG),
    ...checkoutManageCopy(EXAMPLE_LANG),
  };
  const formPayload = {
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
      [F.MANAGE_ADDRESS_CHOICE]: { type: 'string', '__example__': 'addr_0' },
      [F.MANAGE_ADDRESS_OPTIONS]: {
        ...OPTION_LIST_SCHEMA,
        '__example__': exampleAddressOptions(EXAMPLE_LANG),
      },
      [F.DELIVERY_ADDRESS]: { type: 'string', '__example__': 'Hippgasse 11, 1160 Wien' },
      [F.DELIVERY_APARTMENT]: { type: 'string', '__example__': 'Top 14' },
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
          [F.MANAGE_ADDRESS_CHOICE]: `\${data.${F.MANAGE_ADDRESS_CHOICE}}`,
          [F.DELIVERY_ADDRESS]: `\${data.${F.DELIVERY_ADDRESS}}`,
          [F.DELIVERY_APARTMENT]: `\${data.${F.DELIVERY_APARTMENT}}`,
          [F.MANAGE_SET_AS_DEFAULT]: false,
        },
        children: [
          {
            type: 'TextBody',
            text: `\${data.${F.UI_MANAGE_HINT}}`,
          },
          {
            type: 'TextCaption',
            text: `\${data.${F.ERROR_MESSAGE}}`,
            visible: `\${data.${F.ERROR_VISIBLE}}`,
          },
          {
            type: 'RadioButtonsGroup',
            label: `\${data.${F.UI_ADDRESS_CHOICE_LABEL}}`,
            name: F.MANAGE_ADDRESS_CHOICE,
            required: true,
            'data-source': `\${data.${F.MANAGE_ADDRESS_OPTIONS}}`,
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
            type: 'TextInput',
            label: `\${data.${F.UI_ADDRESS_LABEL}}`,
            name: F.DELIVERY_ADDRESS,
            required: true,
          },
          {
            type: 'TextInput',
            label: `\${data.${F.UI_APARTMENT_LABEL}}`,
            name: F.DELIVERY_APARTMENT,
            required: true,
            'helper-text': `\${data.${F.UI_APARTMENT_HELPER}}`,
          },
          {
            // Meta: max 2 EmbeddedLinks per screen. Default uses OptIn; Delete + Back keep the two slots.
            type: 'OptIn',
            label: `\${data.${F.UI_MANAGE_SET_DEFAULT}}`,
            name: F.MANAGE_SET_AS_DEFAULT,
            required: false,
          },
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_MANAGE_DELETE}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: {
                checkout_action: 'manage_delete',
                ...formPayload,
              },
            },
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
      }],
    },
  };
}

function main() {
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
      checkoutReviewScreen(S.CHECKOUT_REVIEW),
      addressManageScreen(S.ADDRESS_MANAGE),
      addressManageScreen(S.ADDRESS_MANAGE_UPDATED),
      checkoutReviewScreen(S.CHECKOUT_REVIEW_RETURN),
      addressManageScreen(S.ADDRESS_MANAGE_AGAIN),
      checkoutReviewScreen(S.CHECKOUT_REVIEW_DONE, { includeManageLink: false }),
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(flow, null, 2));
  console.log(`Written → ${OUT}`);
}

main();
