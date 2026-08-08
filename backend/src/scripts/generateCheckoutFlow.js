#!/usr/bin/env node
// Generates backend/src/flows/checkout-flow.json from JS.
// Run: npm run generate:checkout-flow
// After running, upload the JSON to Meta (Flow Builder or uploadFlow.js).

const fs = require('fs');
const path = require('path');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');

const OUT = path.join(__dirname, '../flows/checkout-flow.json');

const ORDER_TYPE_OPTIONS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
    },
  },
};

function checkoutReviewScreen() {
  return {
    id: S.CHECKOUT_REVIEW,
    title: 'Review order',
    terminal: true,
    data: {
      [F.RECEIPT_TEXT]: {
        type: 'string',
        '__example__': '1x Chicken Dürüm  €8.50\n1x Falafel Box  €6.90\n\nTotal: €15.40',
      },
      [F.CUSTOMER_NAME]: { type: 'string', '__example__': 'Alex Smith' },
      [F.ORDER_TYPE]: { type: 'string', '__example__': 'pickup' },
      [F.ORDER_TYPE_OPTIONS]: {
        ...ORDER_TYPE_OPTIONS_SCHEMA,
        '__example__': [
          { id: 'pickup', title: 'Pickup' },
          { id: 'delivery', title: 'Delivery' },
        ],
      },
      [F.DELIVERY_ADDRESS]: { type: 'string', '__example__': 'Main Street 12, 1010 Vienna' },
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
          [F.DELIVERY_ADDRESS]: `\${data.${F.DELIVERY_ADDRESS}}`,
          [F.CHECKOUT_NOTE]: `\${data.${F.CHECKOUT_NOTE}}`,
        },
        children: [
          {
            type: 'TextBody',
            text: `\${data.${F.RECEIPT_TEXT}}`,
          },
          {
            type: 'TextInput',
            label: 'Name',
            name: F.CUSTOMER_NAME,
            required: true,
          },
          {
            type: 'RadioButtonsGroup',
            label: 'Order type',
            name: F.ORDER_TYPE,
            required: true,
            'data-source': `\${data.${F.ORDER_TYPE_OPTIONS}}`,
          },
          {
            type: 'TextInput',
            label: 'Delivery address',
            name: F.DELIVERY_ADDRESS,
            required: false,
          },
          {
            type: 'TextArea',
            label: 'Note',
            name: F.CHECKOUT_NOTE,
            required: false,
          },
          {
            // EmbeddedLink cannot use `complete` — only data_exchange / navigate / open_url.
            // Endpoint closes the Flow with SUCCESS + checkout_action for nfm_reply.
            type: 'EmbeddedLink',
            text: 'Back to cart',
            'on-click-action': {
              name: 'data_exchange',
              payload: { checkout_action: 'back_to_cart' },
            },
          },
          {
            type: 'Footer',
            label: 'Place order',
            'on-click-action': {
              name: 'complete',
              payload: {
                checkout_action: 'place_order',
                [F.CUSTOMER_NAME]: `\${form.${F.CUSTOMER_NAME}}`,
                [F.ORDER_TYPE]: `\${form.${F.ORDER_TYPE}}`,
                [F.DELIVERY_ADDRESS]: `\${form.${F.DELIVERY_ADDRESS}}`,
                [F.CHECKOUT_NOTE]: `\${form.${F.CHECKOUT_NOTE}}`,
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
      [S.CHECKOUT_REVIEW]: [],
    },
    screens: [checkoutReviewScreen()],
  };

  fs.writeFileSync(OUT, JSON.stringify(flow, null, 2));
  console.log(`Written → ${OUT}`);
}

main();
