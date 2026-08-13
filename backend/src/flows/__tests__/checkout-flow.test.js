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

test('review screens wrap address widgets in If so pickup hides them immediately', () => {
  for (const id of REVIEW_IDS) {
    const addressIf = formChildren(id).find((child) => child.type === 'If');
    expect(addressIf.condition).toBe(`\${form.${F.ORDER_TYPE}} == 'delivery'`);
    const thenNames = addressIf.then.map((child) => child.name);
    expect(thenNames).toEqual(expect.arrayContaining([
      F.ADDRESS_CHOICE,
      F.DELIVERY_ADDRESS,
      F.DELIVERY_APARTMENT,
    ]));
    expect(formChildren(id).find((child) => child.name === F.ADDRESS_CHOICE)).toBeUndefined();
  }
});

test('manage addresses link lives inside the delivery If', () => {
  const addressIf = formChildren(S.CHECKOUT_REVIEW).find((child) => child.type === 'If');
  const manage = addressIf.then.find(
    (child) => child['on-click-action']?.payload?.checkout_action === 'manage_addresses',
  );
  expect(manage).toBeDefined();
});
