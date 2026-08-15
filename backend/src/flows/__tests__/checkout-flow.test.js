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

test('review screens show read-only delivery address (no radio / street inputs)', () => {
  for (const id of REVIEW_IDS) {
    const addressIf = formChildren(id).find((child) => child.type === 'If');
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

test('manage addresses link lives inside the delivery If', () => {
  const addressIf = formChildren(S.CHECKOUT_REVIEW).find((child) => child.type === 'If');
  const manage = addressIf.then.find(
    (child) => child['on-click-action']?.payload?.checkout_action === 'manage_addresses',
  );
  expect(manage).toBeDefined();
});

test('place order payload binds address from data (not form)', () => {
  const footer = formChildren(S.CHECKOUT_REVIEW).find((child) => child.type === 'Footer');
  expect(footer['on-click-action'].payload[F.DELIVERY_ADDRESS]).toBe(`\${data.${F.DELIVERY_ADDRESS}}`);
  expect(footer['on-click-action'].payload[F.ADDRESS_CHOICE]).toBe(`\${data.${F.ADDRESS_CHOICE}}`);
});
