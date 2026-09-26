const flow = require('../checkout-flow.json');
const { SCREENS: S, FIELDS: F } = require('../fields');

function screenById(id) {
  return flow.screens.find((entry) => entry.id === id);
}

function modeBranches() {
  const form = screenById(S.CHECKOUT_REVIEW).layout.children[0];
  const modeIf = form.children[0];
  const nested = modeIf.else[0];
  return {
    manage: modeIf.then,
    cart: nested.then,
    review: nested.else,
  };
}

function countNodes(node, pred, acc = { n: 0 }) {
  if (!node || typeof node !== 'object') return acc;
  if (pred(node)) acc.n += 1;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => countNodes(child, pred, acc));
    else countNodes(value, pred, acc);
  }
  return acc;
}

test('checkout flow is one screen so repeats do not advance the progress bar', () => {
  expect(flow.routing_model).toEqual({ [S.CHECKOUT_REVIEW]: [] });
  expect(flow.screens.map((entry) => entry.id)).toEqual([S.CHECKOUT_REVIEW]);
  expect(screenById(S.CHECKOUT_REVIEW).terminal).toBe(true);
  expect(screenById(S.CHECKOUT_REVIEW).data[F.CHECKOUT_UI_MODE].__example__).toBe('review');
});

test('review mode refreshes on order type select and stays read-only for name and address', () => {
  const { review } = modeBranches();
  const orderType = review.find((child) => child.name === F.ORDER_TYPE);
  expect(orderType['on-select-action']).toEqual(expect.objectContaining({
    name: 'data_exchange',
    payload: expect.objectContaining({
      checkout_action: 'select_order_type',
      checkout_layout: 'single',
    }),
  }));

  const nameDisplay = review.find(
    (child) => child.type === 'TextBody' && child.text === `\${data.${F.CUSTOMER_NAME_DISPLAY}}`,
  );
  expect(nameDisplay).toBeDefined();
  expect(review.find((child) => child.name === F.CUSTOMER_NAME)).toBeUndefined();

  const addressBody = review.find(
    (child) => child.type === 'TextBody' && child.text === `\${data.${F.DELIVERY_ADDRESS_DISPLAY}}`,
  );
  expect(addressBody.visible).toBe(`\${data.${F.ADDRESS_FIELDS_VISIBLE}}`);
  expect(review.find((child) => child.name === F.DELIVERY_ADDRESS)).toBeUndefined();
});

test('profile and cart links sit above the place-order footer', () => {
  const { review } = modeBranches();
  const profileIdx = review.findIndex(
    (child) => child['on-click-action']?.payload?.checkout_action === 'manage_addresses',
  );
  const cartLink = review.find(
    (child) => child['on-click-action']?.payload?.checkout_action === 'open_cart',
  );
  const cartIdx = review.indexOf(cartLink);
  const footerIdx = review.findIndex((child) => child.type === 'Footer');
  const nameIdx = review.findIndex(
    (child) => child.type === 'TextBody' && child.text === `\${data.${F.CUSTOMER_NAME_DISPLAY}}`,
  );
  const typeIdx = review.findIndex((child) => child.name === F.ORDER_TYPE);

  expect(profileIdx).toBeGreaterThan(typeIdx);
  expect(cartIdx).toBe(profileIdx + 1);
  expect(footerIdx).toBe(cartIdx + 1);
  expect(nameIdx).toBeLessThan(typeIdx);
  expect(cartLink['on-click-action'].payload.checkout_layout).toBe('single');
  expect(cartLink['on-click-action'].payload[F.CHECKOUT_UI_MODE]).toBe(`\${data.${F.CHECKOUT_UI_MODE}}`);
});

test('cart mode returns to review on the same screen', () => {
  const { cart } = modeBranches();
  const footer = cart.find((child) => child.type === 'Footer');
  expect(footer['on-click-action'].payload).toEqual(expect.objectContaining({
    checkout_action: 'return_to_review',
    checkout_layout: 'single',
  }));
  expect(cart.find(
    (child) => child['on-click-action']?.payload?.checkout_action === 'cart_remove',
  )).toBeDefined();
  expect(cart.find(
    (child) => child['on-click-action']?.payload?.checkout_action === 'add_more',
  )).toBeDefined();
  expect(cart.find((child) => child['on-click-action']?.name === 'complete')).toBeUndefined();
});

test('place order payload binds name and address from data (not form)', () => {
  const { review } = modeBranches();
  const footer = review.find((child) => child.type === 'Footer');
  expect(footer['on-click-action'].name).toBe('complete');
  expect(footer['on-click-action'].payload[F.CUSTOMER_NAME]).toBe(`\${data.${F.CUSTOMER_NAME}}`);
  expect(footer['on-click-action'].payload[F.DELIVERY_ADDRESS]).toBe(`\${data.${F.DELIVERY_ADDRESS}}`);
  expect(footer['on-click-action'].payload[F.ADDRESS_CHOICE]).toBe(`\${data.${F.ADDRESS_CHOICE}}`);
});

test('manage mode uses Switch so If nesting stays within Meta limits', () => {
  const { manage } = modeBranches();
  const nameInput = manage.find((child) => child.name === F.CUSTOMER_NAME);
  expect(nameInput).toEqual(expect.objectContaining({
    type: 'TextInput',
    required: true,
    visible: `\${data.${F.MANAGE_FORM_VISIBLE}}`,
  }));
  const radio = manage.find((child) => child.name === F.MANAGE_ADDRESS_CHOICE);
  expect(radio.required).toBe(false);
  expect(radio['on-select-action'].payload.checkout_layout).toBe('single');

  const modeSwitch = manage.find((child) => child.type === 'Switch');
  expect(modeSwitch.value).toBe(`\${data.${F.MANAGE_UI_MODE}}`);
  expect(modeSwitch.cases.edit.find((child) => child.type === 'Footer').label)
    .toBe(`\${data.${F.UI_MANAGE_SAVE}}`);
  expect(modeSwitch.cases.list.find((child) => child.type === 'Footer')['on-click-action']
    .payload.checkout_action).toBe('manage_back');
  const deleteLink = modeSwitch.cases.edit.find(
    (child) => child['on-click-action']?.payload?.checkout_action === 'manage_delete',
  );
  expect(deleteLink.visible).toBe(`\${data.${F.MANAGE_DELETE_VISIBLE}}`);
  expect(modeSwitch.cases.list.find((child) => child.type === 'Footer')['on-click-action']
    .payload[F.CUSTOMER_NAME]).toBe(`\${form.${F.CUSTOMER_NAME}}`);
});

function maxIfDepth(node, depth = 0) {
  if (!node || typeof node !== 'object') return depth;
  const here = node.type === 'If' ? depth + 1 : depth;
  let max = here;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) max = Math.max(max, maxIfDepth(child, here));
    } else if (value && typeof value === 'object') {
      max = Math.max(max, maxIfDepth(value, here));
    }
  }
  return max;
}

test('unified screen stays within Meta component and link limits', () => {
  const screen = screenById(S.CHECKOUT_REVIEW);
  expect(maxIfDepth(screen.layout)).toBeLessThanOrEqual(2);
  expect(countNodes(screen.layout, (node) => node.type && node.type !== 'SingleColumnLayout').n)
    .toBeLessThanOrEqual(50);
  const { review, manage, cart } = modeBranches();
  expect(countNodes(review, (node) => node.type === 'EmbeddedLink').n).toBeLessThanOrEqual(2);
  expect(countNodes(cart, (node) => node.type === 'EmbeddedLink').n).toBeLessThanOrEqual(2);
  // Delete, back, and confirm-edit sit in different branches. Same as the old manage screen.
  expect(countNodes(manage, (node) => node.type === 'EmbeddedLink').n).toBeLessThanOrEqual(3);
});
