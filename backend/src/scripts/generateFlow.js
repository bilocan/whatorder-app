#!/usr/bin/env node
// Generates backend/src/flows/menu-flow.json from JS.
// Run: npm run generate:flow
// After running, upload the JSON to Meta (Flow Builder or uploadFlow.js).
//
// UI chrome is localized via ${data.ui_*} filled by /flow/exchange from session.language.
// __example__ data is taken from the Enes pilot menu fixture so Flow Builder /
// Tester preview categories match a real catalog (not mains/sides/drinks).

const fs   = require('fs');
const path = require('path');
const { SCREENS: S, FIELDS: F } = require('../flows/fields');
const { colorTileBase64 } = require('../lib/flowImages');
const {
  categorySelectCopy,
  menuBrowseCopy,
  orderItemCopy,
  cartEditCopy,
  cartDoneCopy,
} = require('../bot/menuFlowCopy');
const { t } = require('../bot/templates');

const OUT = path.join(__dirname, '../flows/menu-flow.json');
const ENES_MENU = require('../../fixtures/intent-corpus/restaurants/enes/menu.json');

const LIST_OPTION_PROPS = {
  id: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  image: { type: 'string' },
  'alt-text': { type: 'string' },
};

const CART_OPTION_PROPS = {
  ...LIST_OPTION_PROPS,
  metadata: { type: 'string' },
};

const CATEGORY_OPTION_PROPS = {
  id: { type: 'string' },
  title: { type: 'string' },
  image: { type: 'string' },
  'alt-text': { type: 'string' },
};

const EXAMPLE_LANG = 'en';

function strField(example) {
  return { type: 'string', '__example__': example };
}

function uiSchema(copy) {
  return Object.fromEntries(
    Object.entries(copy).map(([key, value]) => [key, strField(value)]),
  );
}

/** WhatsApp Flows RadioButtonsGroup title max length. */
function flowTitle(text) {
  const s = String(text ?? '');
  return s.length > 30 ? s.slice(0, 28) + '…' : s;
}

async function withTileImage(opt) {
  const image = await colorTileBase64(opt.id);
  return {
    ...opt,
    image,
    'alt-text': opt.title || opt.id,
  };
}

async function enesCategoriesExample() {
  const seen = new Set();
  const cats = [];
  for (const item of ENES_MENU) {
    const id = item.category || 'other';
    if (seen.has(id)) continue;
    seen.add(id);
    cats.push({ id, title: flowTitle(id) });
  }
  return Promise.all(cats.map(withTileImage));
}

async function enesMenuItemsExample(categoryId = 'Kebap') {
  const items = ENES_MENU
    .filter(i => (i.category || 'other') === categoryId)
    .map(item => ({
      id: item.id,
      title: flowTitle(item.name),
      description: `€${Number(item.price).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`,
    }));
  return Promise.all(items.map(withTileImage));
}

async function buildExamples() {
  const EXAMPLE_CATEGORY = 'Kebap';
  const EXAMPLE_CATEGORIES = await enesCategoriesExample();
  const EXAMPLE_MENU_ITEMS = await enesMenuItemsExample(EXAMPLE_CATEGORY);
  const EXAMPLE_ITEM = ENES_MENU.find(i => i.id === 'enes-kebap-duerum-huhn')
    || ENES_MENU.find(i => i.category === EXAMPLE_CATEGORY)
    || ENES_MENU[0];
  return { EXAMPLE_CATEGORY, EXAMPLE_CATEGORIES, EXAMPLE_MENU_ITEMS, EXAMPLE_ITEM };
}

// ── Screen builders ────────────────────────────────────────────────────────────

function categorySelectScreen(id, exampleCategories) {
  const copy = categorySelectCopy(EXAMPLE_LANG);
  return {
    id,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    data: {
      ...uiSchema(copy),
      [F.CATEGORIES]: {
        type: 'array',
        items: { type: 'object', properties: CATEGORY_OPTION_PROPS },
        '__example__': exampleCategories,
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
            label: `\${data.${F.UI_CATEGORY_PROMPT}}`,
            name: F.CATEGORY_ID,
            required: true,
            'media-size': 'large',
            'data-source': `\${data.${F.CATEGORIES}}`,
          },
          {
            type: 'Footer',
            label: `\${data.${F.UI_NEXT}}`,
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

function menuBrowse(exampleCategory, exampleMenuItems) {
  const copy = menuBrowseCopy(EXAMPLE_LANG);
  return {
    id: S.MENU_BROWSE,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    data: {
      ...uiSchema(copy),
      [F.CATEGORY_TITLE]: { type: 'string', '__example__': exampleCategory },
      [F.MENU_ITEMS]: {
        type: 'array',
        items: { type: 'object', properties: LIST_OPTION_PROPS },
        '__example__': exampleMenuItems,
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
            'media-size': 'large',
            'data-source': `\${data.${F.MENU_ITEMS}}`,
          },
          {
            type: 'Footer',
            label: `\${data.${F.UI_CUSTOMISE}}`,
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

async function orderItem(exampleItem) {
  const copy = orderItemCopy(EXAMPLE_LANG);
  const exampleDesc = exampleItem.description || '';
  const examplePrice = `€${Number(exampleItem.price).toFixed(2)}`;
  return {
    id: S.ORDER_ITEM,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    data: {
      ...uiSchema(copy),
      [F.ITEM_ID]:          { type: 'string', '__example__': exampleItem.id },
      [F.ITEM_NAME]:        { type: 'string', '__example__': exampleItem.name },
      [F.ITEM_DESCRIPTION]: { type: 'string', '__example__': exampleDesc },
      [F.ITEM_DESCRIPTION_VISIBLE]: { type: 'boolean', '__example__': !!exampleDesc },
      [F.ITEM_PRICE]:       { type: 'string', '__example__': examplePrice },
      [F.UI_BACK_TO_CART_VISIBLE]: { type: 'boolean', '__example__': true },
      [F.FORM_INIT_VALUES]: {
        type: 'object',
        properties: {
          [F.QTY]: { type: 'number' },
          [F.NOTES]: { type: 'string' },
          [F.MULTI_VALUE]: { type: 'array', items: { type: 'string' } },
          [F.SLOT1_VALUE]: { type: 'string' },
          [F.SLOT2_VALUE]: { type: 'string' },
          [F.SLOT3_VALUE]: { type: 'string' },
        },
        // Explicit empties: Meta reuses Form state when reopening ORDER_ITEM.
        '__example__': {
          [F.QTY]: 1,
          [F.NOTES]: '',
          [F.MULTI_VALUE]: [],
          [F.SLOT1_VALUE]: '',
          [F.SLOT2_VALUE]: '',
          [F.SLOT3_VALUE]: '',
        },
      },
      [F.ERROR_MESSAGES]: {
        type: 'object',
        properties: { [F.QTY]: { type: 'string' } },
        '__example__': {},
      },
      // Slot 1 (single-select) — flat fields so visible/data-source binding works
      [F.SLOT1_VISIBLE]:  { type: 'boolean', '__example__': true  },
      [F.SLOT1_LABEL]:    { type: 'string',  '__example__': 'Sauce' },
      [F.SLOT1_REQUIRED]: { type: 'boolean', '__example__': true  },
      [F.SLOT1_OPTIONS]:  { ...OPTS_SCHEMA,  '__example__': [{ id: 'knoblauch', title: 'Knoblauch' }, { id: 'scharf', title: 'Scharf' }] },
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
      [F.MULTI_LABEL]:    { type: 'string',  '__example__': 'Extras' },
      [F.MULTI_OPTIONS]:  { ...OPTS_SCHEMA,  '__example__': [{ id: 'kaese', title: 'Käse' }, { id: 'pommes', title: 'Pommes' }] },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'order_form',
        'init-values': `\${data.${F.FORM_INIT_VALUES}}`,
        // Server can set field errors (e.g. qty > 10). Pattern also blocks client-side.
        'error-messages': `\${data.${F.ERROR_MESSAGES}}`,
        children: [
          { type: 'TextHeading', text: `\${data.${F.ITEM_NAME}}` },
          {
            type: 'If',
            condition: `\${data.${F.ITEM_DESCRIPTION_VISIBLE}}`,
            then: [{ type: 'TextCaption', text: `\${data.${F.ITEM_DESCRIPTION}}` }],
          },
          {
            type: 'TextInput',
            label: `\${data.${F.UI_QTY_LABEL}}`,
            name: F.QTY,
            required: true,
            'input-type': 'number',
            'max-chars': 2,
            // Anchored: unanchored (10|[1-9]) wrongly accepts "11".
            pattern: '^(10|[1-9])$',
            'helper-text': `\${data.${F.UI_QTY_HELPER}}`,
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
            label: `\${data.${F.UI_NOTES_LABEL}}`,
            name: F.NOTES,
            required: false,
            'helper-text': `\${data.${F.UI_NOTES_HELPER}}`,
          },
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_BACK_TO_CART}}`,
            visible: `\${data.${F.UI_BACK_TO_CART_VISIBLE}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: { cart_action: 'back_to_cart' },
            },
          },
          {
            type: 'Footer',
            label: `\${data.${F.UI_ADD_TO_CART}}`,
            // Meta requires left-caption whenever right-caption is set.
            'left-caption': `\${data.${F.UI_FOOTER_LEFT_CAPTION}}`,
            'right-caption': `\${data.${F.ITEM_PRICE}}`,
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

async function cartEditScreen(id) {
  const copy = cartEditCopy(EXAMPLE_LANG);
  const exampleRows = await Promise.all([
    withTileImage({
      id: '0',
      title: '1x Dürüm Huhn',
      description: 'Tomaten, Salat, Sauce',
      metadata: '€8.50',
    }),
    withTileImage({
      id: '1',
      title: '1x Falafel Box',
      description: '',
      metadata: '€6.90',
    }),
  ]);
  const discountLabel = t('menuFlowDiscountPercentLabel', EXAMPLE_LANG, 12);
  return {
    id,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    terminal: true,
    data: {
      ...uiSchema(copy),
      [F.SUBTOTAL_LABEL]: { type: 'string', '__example__': t('menuFlowSubtotal', EXAMPLE_LANG, '15.40') },
      [F.DISCOUNT_LABEL]: {
        type: 'string',
        '__example__': t('menuFlowDiscount', EXAMPLE_LANG, discountLabel, '1.85'),
      },
      [F.DISCOUNT_VISIBLE]: { type: 'boolean', '__example__': true },
      [F.DELIVERY_LABEL]: {
        type: 'string',
        '__example__': t('menuFlowDeliveryFee', EXAMPLE_LANG, '0.00'),
      },
      [F.DELIVERY_VISIBLE]: { type: 'boolean', '__example__': false },
      [F.TOTAL_LABEL]:  { type: 'string', '__example__': t('orderTotal', EXAMPLE_LANG, '13.55') },
      [F.BASKET_ITEMS]: {
        type: 'array',
        items: { type: 'object', properties: CART_OPTION_PROPS },
        '__example__': exampleRows,
      },
    },
    layout: {
      type: 'SingleColumnLayout',
      children: [{
        type: 'Form',
        name: 'cart_form',
        children: [
          { type: 'TextCaption', text: `\${data.${F.UI_CART_HINT}}` },
          {
            type: 'CheckboxGroup',
            // required:false keeps Place order enabled with nothing checked.
            // Meta appends a localized "(optional)" suffix to the label (client UI language).
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
            then: [
              { type: 'TextBody', text: `\${data.${F.DISCOUNT_LABEL}}` },
            ],
          },
          {
            type: 'If',
            condition: `\${data.${F.DELIVERY_VISIBLE}}`,
            then: [
              { type: 'TextBody', text: `\${data.${F.DELIVERY_LABEL}}` },
            ],
          },
          { type: 'TextSubheading', text: `\${data.${F.TOTAL_LABEL}}` },
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_REMOVE_SELECTED}}`,
            'on-click-action': {
              name: 'data_exchange',
              payload: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: `\${form.${F.REMOVE_ITEMS}}` },
            },
          },
          {
            type: 'EmbeddedLink',
            text: `\${data.${F.UI_ADD_MORE}}`,
            'on-click-action': { name: 'data_exchange', payload: { cart_action: 'add_more' } },
          },
          {
            type: 'Footer',
            label: `\${data.${F.UI_PLACE_ORDER}}`,
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
  const copy = cartDoneCopy(EXAMPLE_LANG);
  return {
    id: S.CART_DONE,
    title: `\${data.${F.UI_SCREEN_TITLE}}`,
    terminal: true,
    data: {
      ...uiSchema(copy),
      [F.BASKET_TEXT]: { type: 'string', '__example__': '1x Dürüm Huhn  €8.50' },
      [F.TOTAL_LABEL]: { type: 'string', '__example__': t('orderTotal', EXAMPLE_LANG, '8.50') },
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
            text: `\${data.${F.UI_ADD_MORE}}`,
            'on-click-action': { name: 'data_exchange', payload: { cart_action: 'add_more' } },
          },
          {
            type: 'Footer',
            label: `\${data.${F.UI_PLACE_ORDER}}`,
            'on-click-action': { name: 'complete', payload: {} },
          },
        ],
      }],
    },
  };
}

// ── Build & write ──────────────────────────────────────────────────────────────

async function main() {
  const {
    EXAMPLE_CATEGORY,
    EXAMPLE_CATEGORIES,
    EXAMPLE_MENU_ITEMS,
    EXAMPLE_ITEM,
  } = await buildExamples();

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
      categorySelectScreen(S.CATEGORY_SELECT, EXAMPLE_CATEGORIES),
      categorySelectScreen(S.CATEGORY_SELECT_RETURN, EXAMPLE_CATEGORIES),
      menuBrowse(EXAMPLE_CATEGORY, EXAMPLE_MENU_ITEMS),
      await orderItem(EXAMPLE_ITEM),
      await cartReview(),
      await cartUpdated(),
      cartDone(),
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(flow, null, 2));
  console.log(`Written → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
