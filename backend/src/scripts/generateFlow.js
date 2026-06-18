#!/usr/bin/env node
// Generates backend/src/flows/menu-flow.json from JS.
// Run: npm run generate:flow
// After running, upload the JSON to Meta (Flow Builder or uploadFlow.js).

const fs   = require('fs');
const path = require('path');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');

const OUT = path.join(__dirname, '../flows/menu-flow.json');

// ── Screen builders ────────────────────────────────────────────────────────────

function categorySelectScreen(id) {
  return {
    id,
    title: 'Menu',
    data: {
      [F.CATEGORIES]: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
        '__example__': [
          { id: 'mains',  title: 'Mains'  },
          { id: 'sides',  title: 'Sides'  },
          { id: 'drinks', title: 'Drinks' },
        ],
      },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'category_form',
        children: [
          {
            type: 'RadioButtonsGroup',
            label: 'What would you like?',
            name: F.CATEGORY_ID,
            required: true,
            'data-source': `\${data.${F.CATEGORIES}}`,
          },
          {
            type: 'Footer',
            label: 'Next',
            'on-click-action': {
              name: 'data_exchange',
              payload: { [F.CATEGORY_ID]: `\${form.${F.CATEGORY_ID}}` },
            },
          },
        ],
      }],
    },
  };
}

function categorySelect() { return categorySelectScreen(S.CATEGORY_SELECT); }

function menuBrowse() {
  return {
    id: S.MENU_BROWSE,
    title: 'Menu',
    data: {
      [F.CATEGORY_TITLE]: { type: 'string', '__example__': 'Mains' },
      [F.MENU_ITEMS]: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } } },
        '__example__': [
          { id: 'item_1', title: 'Döner',   description: '€7.50 — Chicken or lamb' },
          { id: 'item_2', title: 'Falafel', description: '€6.00' },
        ],
      },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'item_form',
        children: [
          {
            type: 'RadioButtonsGroup',
            label: `\${data.${F.CATEGORY_TITLE}}`,
            name: F.ITEM_ID,
            required: true,
            'data-source': `\${data.${F.MENU_ITEMS}}`,
          },
          {
            type: 'Footer',
            label: 'Customise',
            'on-click-action': {
              name: 'data_exchange',
              payload: { [F.ITEM_ID]: `\${form.${F.ITEM_ID}}` },
            },
          },
        ],
      }],
    },
  };
}

const OPTS_SCHEMA = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } } };

function radioSlot(n) {
  return {
    type: 'RadioButtonsGroup',
    label: `\${data.${F[`SLOT${n}_LABEL`]}}`,
    name: F[`SLOT${n}_VALUE`],
    required: `\${data.${F[`SLOT${n}_REQUIRED`]}}`,
    visible: `\${data.${F[`SLOT${n}_VISIBLE`]}}`,
    'data-source': `\${data.${F[`SLOT${n}_OPTIONS`]}}`,
  };
}

function orderItem() {
  return {
    id: S.ORDER_ITEM,
    title: 'Customise',
    data: {
      [F.ITEM_ID]:          { type: 'string', '__example__': 'item_1' },
      [F.ITEM_NAME]:        { type: 'string', '__example__': 'Döner' },
      [F.ITEM_DESCRIPTION]: { type: 'string', '__example__': 'Chicken or lamb' },
      [F.ITEM_PRICE]:       { type: 'string', '__example__': '€7.50' },
      [F.QTY_OPTIONS]:      { ...OPTS_SCHEMA, '__example__': [{ id: '1', title: '1' }, { id: '2', title: '2' }, { id: '3', title: '3' }] },
      // Slot 1 (single-select) — flat fields so visible/data-source binding works
      [F.SLOT1_VISIBLE]:  { type: 'boolean', '__example__': true  },
      [F.SLOT1_LABEL]:    { type: 'string',  '__example__': 'Protein' },
      [F.SLOT1_REQUIRED]: { type: 'boolean', '__example__': true  },
      [F.SLOT1_OPTIONS]:  { ...OPTS_SCHEMA,  '__example__': [{ id: 'chicken', title: 'Chicken' }, { id: 'lamb', title: 'Lamb' }] },
      // Slot 2
      [F.SLOT2_VISIBLE]:  { type: 'boolean', '__example__': false },
      [F.SLOT2_LABEL]:    { type: 'string',  '__example__': 'Option' },
      [F.SLOT2_REQUIRED]: { type: 'boolean', '__example__': false },
      [F.SLOT2_OPTIONS]:  { ...OPTS_SCHEMA,  '__example__': [{ id: 'opt', title: 'Option' }] },
      // Slot 3
      [F.SLOT3_VISIBLE]:  { type: 'boolean', '__example__': false },
      [F.SLOT3_LABEL]:    { type: 'string',  '__example__': 'Option' },
      [F.SLOT3_REQUIRED]: { type: 'boolean', '__example__': false },
      [F.SLOT3_OPTIONS]:  { ...OPTS_SCHEMA,  '__example__': [{ id: 'opt', title: 'Option' }] },
      // Multi-select slot
      [F.MULTI_VISIBLE]:  { type: 'boolean', '__example__': true },
      [F.MULTI_LABEL]:    { type: 'string',  '__example__': 'Sauce' },
      [F.MULTI_OPTIONS]:  { ...OPTS_SCHEMA,  '__example__': [{ id: 'garlic', title: 'Garlic sauce' }, { id: 'chili', title: 'Chili sauce' }] },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'order_form',
        children: [
          { type: 'TextHeading', text: `\${data.${F.ITEM_NAME}}` },
          { type: 'TextBody',    text: `\${data.${F.ITEM_PRICE}}` },
          {
            type: 'RadioButtonsGroup',
            label: 'Quantity',
            name: F.QTY,
            required: true,
            'data-source': `\${data.${F.QTY_OPTIONS}}`,
          },
          radioSlot(1),
          radioSlot(2),
          radioSlot(3),
          {
            type: 'CheckboxGroup',
            label: `\${data.${F.MULTI_LABEL}}`,
            name: F.MULTI_VALUE,
            required: false,
            visible: `\${data.${F.MULTI_VISIBLE}}`,
            'data-source': `\${data.${F.MULTI_OPTIONS}}`,
          },
          {
            type: 'TextArea',
            label: 'Special requests',
            name: F.NOTES,
            required: false,
            'helper-text': 'Allergies, extra sauce, etc.',
          },
          {
            type: 'Footer',
            label: 'Add to cart',
            'on-click-action': {
              name: 'data_exchange',
              payload: {
                [F.ITEM_ID]:    `\${data.${F.ITEM_ID}}`,
                [F.QTY]:        `\${form.${F.QTY}}`,
                [F.SLOT1_VALUE]: `\${form.${F.SLOT1_VALUE}}`,
                [F.SLOT2_VALUE]: `\${form.${F.SLOT2_VALUE}}`,
                [F.SLOT3_VALUE]: `\${form.${F.SLOT3_VALUE}}`,
                [F.MULTI_VALUE]: `\${form.${F.MULTI_VALUE}}`,
                [F.NOTES]:       `\${form.${F.NOTES}}`,
              },
            },
          },
        ],
      }],
    },
  };
}

function cartReview() { return cartEditScreen(S.CART_REVIEW); }

function cartEditScreen(id) {
  return {
    id,
    title: 'Your cart',
    terminal: true,
    data: {
      [F.BASKET_TEXT]:  { type: 'string', '__example__': '1x Döner  €10.00\n2x Falafel  €12.00' },
      [F.TOTAL_LABEL]:  { type: 'string', '__example__': 'Total: €22.00' },
      [F.BASKET_ITEMS]: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } } },
        '__example__': [{ id: '0', title: '1x Döner' }, { id: '1', title: '2x Falafel' }, { id: 'clear', title: 'Clear entire cart' }],
      },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'cart_form',
        children: [
          { type: 'TextBody',       text: `\${data.${F.BASKET_TEXT}}` },
          { type: 'TextSubheading', text: `\${data.${F.TOTAL_LABEL}}` },
          { type: 'TextCaption',    text: 'Check items to remove, then tap Remove. Or go straight to Place order.' },
          {
            type: 'CheckboxGroup',
            label: 'Remove items:',
            name: F.REMOVE_ITEMS,
            required: false,
            'data-source': `\${data.${F.BASKET_ITEMS}}`,
          },
          {
            type: 'EmbeddedLink',
            text: 'Remove selected items',
            'on-click-action': {
              name: 'data_exchange',
              payload: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: `\${form.${F.REMOVE_ITEMS}}` },
            },
          },
          {
            type: 'EmbeddedLink',
            text: 'Add more items',
            'on-click-action': { name: 'data_exchange', payload: { cart_action: 'add_more' } },
          },
          {
            type: 'Footer',
            label: 'Place order',
            'on-click-action': { name: 'complete', payload: {} },
          },
        ],
      }],
    },
  };
}

function cartUpdated() { return cartEditScreen(S.CART_UPDATED); }

// Final cart — no remove UI.
function cartDone() {
  return {
    id: S.CART_DONE,
    title: 'Your cart',
    terminal: true,
    data: {
      [F.BASKET_TEXT]: { type: 'string', '__example__': '1x Döner  €10.00' },
      [F.TOTAL_LABEL]: { type: 'string', '__example__': 'Total: €10.00' },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'cart_done_form',
        children: [
          { type: 'TextBody',       text: `\${data.${F.BASKET_TEXT}}` },
          { type: 'TextSubheading', text: `\${data.${F.TOTAL_LABEL}}` },
          {
            type: 'EmbeddedLink',
            text: 'Add more items',
            'on-click-action': { name: 'data_exchange', payload: { cart_action: 'add_more' } },
          },
          {
            type: 'Footer',
            label: 'Place order',
            'on-click-action': { name: 'complete', payload: {} },
          },
        ],
      }],
    },
  };
}

// ── Build & write ──────────────────────────────────────────────────────────────

const flow = {
  version: '7.3',
  data_api_version: '3.0',
  routing_model: {
    [S.CATEGORY_SELECT]:        [S.MENU_BROWSE],
    [S.CATEGORY_SELECT_RETURN]: [S.MENU_BROWSE],
    [S.MENU_BROWSE]:            [S.ORDER_ITEM],
    [S.ORDER_ITEM]:             [S.CART_REVIEW],
    [S.CART_REVIEW]:  [S.CATEGORY_SELECT_RETURN, S.CART_UPDATED],
    [S.CART_UPDATED]: [S.CATEGORY_SELECT_RETURN, S.CART_DONE],
    [S.CART_DONE]:    [S.CATEGORY_SELECT_RETURN],
  },
  screens: [
    categorySelect(),
    categorySelectScreen(S.CATEGORY_SELECT_RETURN),
    menuBrowse(),
    orderItem(),
    cartReview(),
    cartUpdated(),
    cartDone(),
  ],
};

fs.writeFileSync(OUT, JSON.stringify(flow, null, 2));
console.log(`Written → ${OUT}`);
