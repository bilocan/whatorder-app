const flow = require('../checkout-flow.json');
const { SCREENS: S, FIELDS: F } = require('../fields');

function formChildren(screenId) {
  const screen = flow.screens.find((entry) => entry.id === screenId);
  return screen.layout.children[0].children;
}

const REVIEW_IDS = [S.CHECKOUT_REVIEW, S.CHECKOUT_REVIEW_RETURN, S.CHECKOUT_REVIEW_DONE];

test('review screens refresh on order type select', () => {
  for (const id of REVIEW_IDS) {
    const orderType = formChildren(id).find((child) => child.name === F.ORDER_TYPE);
    expect(orderType['on-select-action']).toEqual(expect.objectContaining({
      name: 'data_exchange',
      payload: expect.objectContaining({ checkout_action: 'select_order_type' }),
    }));
  }
});

test('review screens show read-only name and delivery address', () => {
  for (const id of REVIEW_IDS) {
    const children = formChildren(id);
    const nameDisplay = children.find(
      (child) => child.type === 'TextBody' && child.text === `\${data.${F.CUSTOMER_NAME_DISPLAY}}`,
    );
    expect(nameDisplay).toBeDefined();
    expect(children.find((child) => child.name === F.CUSTOMER_NAME)).toBeUndefined();
    expect(children.find(
      (child) => child.type === 'TextCaption' && child.text === `\${data.${F.UI_NAME_LABEL}}`,
    )).toBeDefined();

    const addressIf = children.find((child) => child.type === 'If');
    expect(addressIf.condition).toBe(`\${form.${F.ORDER_TYPE}} == 'delivery'`);
    const thenTypes = addressIf.then.map((child) => child.type);
    expect(thenTypes).toContain('TextCaption');
    expect(thenTypes).toContain('TextBody');
    expect(addressIf.then.find((child) => child.name === F.ADDRESS_CHOICE)).toBeUndefined();
    expect(addressIf.then.find((child) => child.name === F.DELIVERY_ADDRESS)).toBeUndefined();
    expect(addressIf.then.find((child) => child.name === F.DELIVERY_APARTMENT)).toBeUndefined();
    const addressBody = addressIf.then.find(
      (child) => child.type === 'TextBody' && child.text === `\${data.${F.DELIVERY_ADDRESS_DISPLAY}}`,
    );
    expect(addressBody).toBeDefined();
  }
});

test('profile edit link sits with Sepete dön above the place-order footer', () => {
  for (const id of REVIEW_IDS) {
    const children = formChildren(id);
    const profileIdx = children.findIndex(
      (child) => child['on-click-action']?.payload?.checkout_action === 'manage_addresses',
    );
    const cartIdx = children.findIndex(
      (child) => child['on-click-action']?.payload?.checkout_action === 'back_to_cart',
    );
    const footerIdx = children.findIndex((child) => child.type === 'Footer');
    const nameIdx = children.findIndex(
      (child) => child.type === 'TextBody' && child.text === `\${data.${F.CUSTOMER_NAME_DISPLAY}}`,
    );
    const typeIdx = children.findIndex((child) => child.name === F.ORDER_TYPE);

    expect(profileIdx).toBeGreaterThan(-1);
    expect(cartIdx).toBe(profileIdx + 1);
    expect(footerIdx).toBe(cartIdx + 1);
    expect(profileIdx).toBeGreaterThan(typeIdx);
    expect(nameIdx).toBeLessThan(typeIdx);
  }
});

test('place order payload binds name and address from data (not form)', () => {
  const footer = formChildren(S.CHECKOUT_REVIEW).find((child) => child.type === 'Footer');
  expect(footer['on-click-action'].payload[F.CUSTOMER_NAME]).toBe(`\${data.${F.CUSTOMER_NAME}}`);
  expect(footer['on-click-action'].payload[F.DELIVERY_ADDRESS]).toBe(`\${data.${F.DELIVERY_ADDRESS}}`);
  expect(footer['on-click-action'].payload[F.ADDRESS_CHOICE]).toBe(`\${data.${F.ADDRESS_CHOICE}}`);
});

test('manage screen has profile name + list/edit footers under confirm If', () => {
  const children = formChildren(S.ADDRESS_MANAGE);
  const confirmIf = children.find(
    (child) => child.type === 'If'
      && child.condition === `\${data.${F.MANAGE_UI_MODE}} == 'confirm'`,
  );
  expect(confirmIf).toBeDefined();

  const nameInput = confirmIf.else.find((child) => child.name === F.CUSTOMER_NAME);
  expect(nameInput).toEqual(expect.objectContaining({
    type: 'TextInput',
    required: true,
  }));

  const editIf = confirmIf.else.find(
    (child) => child.type === 'If'
      && child.condition === `\${data.${F.MANAGE_UI_MODE}} == 'edit'`,
  );
  expect(editIf).toBeDefined();
  expect(editIf.else.find((child) => child.type === 'Footer').label)
    .toBe(`\${data.${F.UI_MANAGE_BACK}}`);
  expect(editIf.else.find((child) => child.type === 'Footer')['on-click-action']
    .payload.checkout_action).toBe('manage_back');
  expect(editIf.then.find((child) => child.type === 'Footer').label)
    .toBe(`\${data.${F.UI_MANAGE_SAVE}}`);
  const radio = confirmIf.else.find((child) => child.name === F.MANAGE_ADDRESS_CHOICE);
  expect(radio.required).toBe(false);
  const deleteIf = editIf.then.find(
    (child) => child.type === 'If'
      && child.condition === `\${form.${F.MANAGE_ADDRESS_CHOICE}} != 'addr_new'`,
  );
  expect(deleteIf.then[0]['on-click-action'].payload.checkout_action).toBe('manage_delete');
  const listBack = editIf.else.find((child) => child.type === 'Footer');
  expect(listBack['on-click-action'].payload[F.CUSTOMER_NAME])
    .toBe(`\${form.${F.CUSTOMER_NAME}}`);
});
