jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/collections');
jest.mock('../../bot/menuService');
jest.mock('../../bot/customerAddresses');
jest.mock('../../bot/checkoutDeal', () => {
  const actual = jest.requireActual('../../bot/checkoutDeal');
  return {
    ...actual,
    loadCheckoutTotals: jest.fn(actual.loadCheckoutTotals),
  };
});

const { sessionRef, customersRef } = require('../../lib/collections');
const { getBusinessInfo } = require('../../bot/menuService');
const { loadCheckoutTotals } = require('../../bot/checkoutDeal');
const {
  loadCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
} = require('../../bot/customerAddresses');
const { SCREENS: S, FIELDS: F } = require('../../flows/fields');
const { buildCheckoutDataExchangeResponse, buildCheckoutInitResponse } = require('../flowCheckout');

const PHONE = 'phone1';
const BUSINESS_ID = 'biz1';
const VERSION = '3.0';
const FLOW_TOKEN = `${PHONE}|${BUSINESS_ID}|checkout`;
const ADDRESS_1 = 'Hippgasse 11, Top 14, 1160 Wien';
const ADDRESS_2 = 'Naschmarkt 5, Top 2, 1040 Wien';

function mockSession(overrides = {}) {
  const session = {
    businessId: BUSINESS_ID,
    language: 'en',
    basket: [{ name: 'Burger', qty: 1, price: 10 }],
    customerName: 'Alex',
    orderType: 'delivery',
    deliveryAddress: ADDRESS_1,
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'stale street',
      deliveryApartment: 'Top 99',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
    ...overrides,
  };
  const ref = {
    get: jest.fn().mockResolvedValue({ exists: true, data: () => session }),
    set: jest.fn().mockResolvedValue(undefined),
  };
  sessionRef.mockReturnValue(ref);
  return { ref, session };
}

function exchange(screen, payload) {
  return buildCheckoutDataExchangeResponse({
    screen,
    payload,
    flow_token: FLOW_TOKEN,
    version: VERSION,
    phone: PHONE,
    businessId: BUSINESS_ID,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession();
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
  });
  customersRef.mockReturnValue({
    doc: () => ({
      get: jest.fn().mockResolvedValue({
        data: () => ({
          savedAddresses: [ADDRESS_1, ADDRESS_2],
          lastDeliveryAddress: ADDRESS_1,
        }),
      }),
    }),
  });
});

test('INIT fails closed when session businessId is missing', async () => {
  mockSession({ businessId: undefined, customerName: 'Alex', basket: [{ name: 'Burger', qty: 1, price: 10 }] });

  const response = await buildCheckoutInitResponse({
    phone: PHONE,
    businessId: BUSINESS_ID,
    version: VERSION,
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.CUSTOMER_NAME]).toBe('');
  expect(response.data[F.ADDRESS_OPTIONS].map((o) => o.id)).toEqual(['addr_new']);
  expect(response.data.receipt_text).not.toContain('Burger');
});

test('INIT resolves checkout totals with the token phone and renders a live deal', async () => {
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: false,
    deals: {
      window: {
        dealId: 'deal-window',
        kind: 'window',
        discountType: 'percent',
        discountValue: 10,
        label: '10% Willkommen',
        active: true,
        startsAt: new Date('2020-01-01T00:00:00.000Z'),
        endsAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    },
  });
  mockSession({ orderType: 'pickup', confirmFlowDraft: null });

  const response = await buildCheckoutInitResponse({
    phone: PHONE,
    businessId: BUSINESS_ID,
    version: VERSION,
  });

  expect(loadCheckoutTotals).toHaveBeenCalledWith(expect.objectContaining({
    businessId: BUSINESS_ID,
    customerPhone: PHONE,
  }));
  expect(response.data[F.RECEIPT_TEXT]).toContain('10% Willkommen');
  expect(response.data[F.RECEIPT_TEXT]).toContain('€9.00');
});

test('manage_addresses opens the manage screen with current profile options', async () => {
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'manage_addresses',
  });

  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_ADDRESS_CHOICE]).toBe('addr_0');
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS].map((option) => option.id))
    .toEqual(['addr_0', 'addr_1', 'addr_new']);
});

test('select_order_type pickup hides address fields and keeps the typed note', async () => {
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
    deliveryFee: 2,
  });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_0',
    [F.DELIVERY_ADDRESS]: ADDRESS_1,
    [F.DELIVERY_APARTMENT]: 'Top 14',
    [F.CHECKOUT_NOTE]: 'Keep me',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.ORDER_TYPE]).toBe('pickup');
  expect(response.data[F.ADDRESS_FIELDS_VISIBLE]).toBe(false);
  expect(response.data[F.CHECKOUT_NOTE]).toBe('Keep me');
  expect(response.data[F.RECEIPT_TEXT]).toContain('Total: €10.00');
  expect(response.data[F.RECEIPT_TEXT]).not.toContain('Delivery to:');
});

test('select_order_type pickup then delivery keeps a typed Neue Adresse when hidden fields are empty', async () => {
  const novel = 'Brandgasse 8, Top 1, 1020 Wien';
  mockSession({
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      orderType: 'delivery',
      addressChoice: 'addr_new',
      deliveryAddress: novel,
      deliveryApartment: 'Top 1',
    },
  });

  const pickup = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(pickup.data[F.ORDER_TYPE]).toBe('pickup');
  expect(pickup.data[F.DELIVERY_ADDRESS]).toBe(novel);
  expect(pickup.data[F.ADDRESS_CHOICE]).toBe('addr_new');

  const delivery = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(delivery.data[F.ORDER_TYPE]).toBe('delivery');
  expect(delivery.data[F.ADDRESS_CHOICE]).toBe('addr_new');
  expect(delivery.data[F.DELIVERY_ADDRESS]).toBe(novel);
  expect(delivery.data[F.DELIVERY_APARTMENT]).toBe('Top 1');
});

test('select_order_type pickup stashes a typed street from the payload for the next delivery tap', async () => {
  const novel = 'Brandgasse 8, Top 1, 1020 Wien';
  mockSession({
    orderType: 'delivery',
    confirmFlowDraft: null,
    deliveryAddress: ADDRESS_1,
  });

  await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: novel,
    [F.DELIVERY_APARTMENT]: 'Top 1',
  });

  const delivery = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(delivery.data[F.ORDER_TYPE]).toBe('delivery');
  expect(delivery.data[F.ADDRESS_CHOICE]).toBe('addr_new');
  expect(delivery.data[F.DELIVERY_ADDRESS]).toBe(novel);
  expect(delivery.data[F.DELIVERY_APARTMENT]).toBe('Top 1');
});

test('select_order_type delivery restores the default saved address instead of Neue Adresse', async () => {
  mockSession({ orderType: 'pickup', confirmFlowDraft: { orderType: 'pickup' } });
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(response.data[F.ORDER_TYPE]).toBe('delivery');
  expect(response.data[F.ADDRESS_CHOICE]).toBe('addr_0');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_1);
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 14');
});

test('select_order_type delivery shows address fields and prices in the delivery fee', async () => {
  mockSession({ orderType: 'pickup', confirmFlowDraft: { orderType: 'pickup' } });
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
    deliveryFee: 2,
  });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.CHECKOUT_NOTE]: 'Keep me',
  });

  expect(response.data[F.ORDER_TYPE]).toBe('delivery');
  expect(response.data[F.ADDRESS_FIELDS_VISIBLE]).toBe(true);
  expect(response.data[F.CHECKOUT_NOTE]).toBe('Keep me');
  expect(response.data[F.RECEIPT_TEXT]).toContain('Total: €12.00');
  expect(response.data[F.RECEIPT_TEXT]).toContain('Delivery to:');
});

test('select_address while pickup stays pickup and does not treat a radio refresh as delivery', async () => {
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_address',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: ADDRESS_1,
    [F.DELIVERY_APARTMENT]: 'Top 14',
    [F.CHECKOUT_NOTE]: 'Keep me',
  });

  expect(response.data[F.ORDER_TYPE]).toBe('pickup');
  expect(response.data[F.ADDRESS_FIELDS_VISIBLE]).toBe(false);
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_1);
  expect(response.data[F.CHECKOUT_NOTE]).toBe('Keep me');
});

test('select_address keeps pickup when the customer is still on Abholung', async () => {
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
    minimumOrderValue: 50,
  });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_address',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_1',
  });

  expect(response.data[F.ORDER_TYPE]).toBe('pickup');
  expect(response.data[F.ADDRESS_FIELDS_VISIBLE]).toBe(false);
});

test('select_order_type delivery below minimum closes Flow with delivery_below_minimum', async () => {
  const { ref } = mockSession({
    orderType: 'pickup',
    deliveryAddress: null,
    basket: [{ name: 'Pommes', qty: 1, price: 4.5 }],
    confirmFlowDraft: null,
  });
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
    deliveryFee: 2,
    minimumOrderValue: 10,
  });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.ORDER_TYPE]: 'delivery',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.CHECKOUT_NOTE]: '',
  });

  expect(response.screen).toBe('SUCCESS');
  expect(response.data.extension_message_response.params).toEqual({
    flow_token: FLOW_TOKEN,
    checkout_action: 'delivery_below_minimum',
  });
  expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
    orderType: 'delivery',
    deliveryAddress: null,
    confirmFlowDraft: null,
  }), { merge: true });
});

test('select_order_type delivery at/above minimum stays on review', async () => {
  mockSession({
    orderType: 'pickup',
    basket: [{ name: 'Burger', qty: 2, price: 10 }],
    confirmFlowDraft: null,
  });
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
    deliveryFee: 2,
    minimumOrderValue: 10,
  });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.ORDER_TYPE]: 'delivery',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.CHECKOUT_NOTE]: '',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.ORDER_TYPE]).toBe('delivery');
  expect(response.data[F.ADDRESS_FIELDS_VISIBLE]).toBe(true);
});

test('select_address on review refills street and apartment from the chosen row', async () => {
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_address',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: 'stale street from previous row',
    [F.DELIVERY_APARTMENT]: 'Top 99',
    [F.CHECKOUT_NOTE]: 'Keep me',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.ADDRESS_CHOICE]).toBe('addr_1');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_2);
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 2');
  expect(response.data[F.CUSTOMER_NAME]).toBe('Alex');
  expect(response.data[F.CHECKOUT_NOTE]).toBe('Keep me');
});

test('select_address on manage refills fields and ignores stale TextInputs', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'select_address',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: 'stale street',
    [F.DELIVERY_APARTMENT]: 'Top 99',
  });

  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_ADDRESS_CHOICE]).toBe('addr_1');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_2);
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 2');
});

test('select_address Neue Adresse clears street and apartment', async () => {
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_address',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'should clear',
    [F.DELIVERY_APARTMENT]: 'Top 1',
  });

  expect(response.data[F.ADDRESS_CHOICE]).toBe('addr_new');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('');
});

test('tenant mismatch refuses a profile mutation before save', async () => {
  mockSession({ businessId: 'other-biz' });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'New Street 3, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(loadCustomerAddresses).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data.error_message).toBe('Unable to update addresses. Please try again.');
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS]).toHaveLength(1);
});

test('missing session businessId refuses a profile mutation before save', async () => {
  mockSession({ businessId: undefined });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'New Street 3, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(loadCustomerAddresses).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data.error_message).toBe('Unable to update addresses. Please try again.');
});

test('tenant mismatch still allows read-only manage_back with review-shaped data', async () => {
  mockSession({ businessId: 'other-biz' });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
  });

  expect(loadCustomerAddresses).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.ADDRESS_OPTIONS]).toHaveLength(1);
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS]).toBeUndefined();
  expect(response.data[F.RECEIPT_TEXT]).not.toContain('Burger');
});

test('tenant mismatch on a review screen answers with review-shaped data', async () => {
  mockSession({ businessId: 'other-biz' });

  const response = await exchange(S.CHECKOUT_REVIEW_DONE, {
    checkout_action: 'manage_addresses',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW_DONE);
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS]).toBeUndefined();
  expect(response.data[F.ADDRESS_OPTIONS]).toBeDefined();
});

test('an unknown action on a review screen answers with review-shaped data', async () => {
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'something_else',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS]).toBeUndefined();
  expect(response.data[F.ADDRESS_OPTIONS].at(-1).id).toBe('addr_new');
  expect(response.data[F.RECEIPT_TEXT]).toContain('Burger');
});

test('manage screens always carry an error slot, empty when there is nothing to report', async () => {
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'manage_addresses',
  });

  expect(response.data[F.ERROR_MESSAGE]).toBe('');
  expect(response.data[F.ERROR_VISIBLE]).toBe(false);
});

test('manage errors are flagged visible for the manage screen caption', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_99',
  });

  expect(response.data[F.ERROR_MESSAGE]).toBe('Select a saved address first.');
  expect(response.data[F.ERROR_VISIBLE]).toBe(true);
});

test('manage_save on a saved row with untouched inputs is a keep, not a rewrite', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
  expect(response.data[F.ERROR_VISIBLE]).toBe(false);
});

test('manage_save on a saved row with inputs matching that label writes nothing', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
    [F.DELIVERY_ADDRESS]: 'Hippgasse 11, 1160 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 14',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
});

test('manage_save on Neue Adresse with empty fields shows a visible error', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.ERROR_VISIBLE]).toBe(true);
  expect(response.data[F.ERROR_MESSAGE]).toBeTruthy();
});

test('a failed profile write keeps the customer on manage with the generic error', async () => {
  saveCustomerAddress.mockResolvedValue({
    ok: false,
    errorKey: 'confirmFlowErrorManageGeneric',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'New Street 3, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.ERROR_MESSAGE]).toBe('Unable to update addresses. Please try again.');
  expect(response.data[F.ERROR_VISIBLE]).toBe(true);
});

test('manage_save edits using the exact profile label behind the selected option', async () => {
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_2, 'New Street 3, Top 4, 1020 Wien'],
    lastDeliveryAddress: 'New Street 3, Top 4, 1020 Wien',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
    [F.DELIVERY_ADDRESS]: 'New Street 3, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: 'New Street 3, Top 4, 1020 Wien',
    replaceLabel: ADDRESS_1,
  });
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
});

test('manage_save refuses an edit choice that is not in the current profile options', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_99',
    [F.DELIVERY_ADDRESS]: 'New Street 3, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data.error_message).toBe('Select a saved address first.');
});

test('manage_save cap error stays on the same manage screen with current options', async () => {
  saveCustomerAddress.mockResolvedValue({
    ok: false,
    errorKey: 'confirmFlowErrorManageCap',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'New Street 3, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data.error_message).toContain('max 5');
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS]).toHaveLength(3);
});

test('manage_set_default uses the exact selected profile label', async () => {
  setDefaultCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_2,
  });

  await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_set_default',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
  });

  expect(setDefaultCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_2,
  });
});

test('manage_save with OptIn set-as-default calls setDefault after save', async () => {
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
  });
  setDefaultCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_2,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: 'Naschmarkt 5, 1040 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 2',
    [F.MANAGE_SET_AS_DEFAULT]: true,
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled(); // unchanged fields → skip rewrite
  expect(setDefaultCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_2,
  });
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
});

test('manage_delete returning to review clears deleted session and draft address fields', async () => {
  const { ref } = mockSession({
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'Hippgasse 11, 1160 Wien',
      deliveryApartment: 'Top 14',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
  });
  deleteCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_2],
    lastDeliveryAddress: ADDRESS_2,
  });

  const response = await exchange(S.ADDRESS_MANAGE_UPDATED, {
    checkout_action: 'manage_delete',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
  });

  expect(deleteCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_1,
  });
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_2);
  expect(ref.set).toHaveBeenCalledWith({
    deliveryAddress: null,
    confirmFlowDraft: {
      customerName: 'Alex',
      specialRequests: 'Ring twice',
    },
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_delete acts on a lastDeliveryAddress-only row', async () => {
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [],
    lastDeliveryAddress: ADDRESS_1,
  });
  deleteCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [],
    lastDeliveryAddress: null,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_delete',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
  });

  expect(deleteCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_1,
  });
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
});

test('manage_back rebuilds review from profile and patches stale address draft', async () => {
  const { ref } = mockSession({
    // Draft mirrors the deleted session address → address fields must clear.
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'Hippgasse 11, 1160 Wien',
      deliveryApartment: 'Top 14',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_2],
    lastDeliveryAddress: ADDRESS_2,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.ADDRESS_OPTIONS][0].title).toBe('Naschmarkt 5');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_2);
  expect(ref.set).toHaveBeenCalledWith({
    confirmFlowDraft: {
      customerName: 'Alex',
      specialRequests: 'Ring twice',
    },
    updatedAt: expect.any(Date),
    deliveryAddress: null,
  }, { merge: true });
});

test('manage_back keeps novel unsaved review address edits', async () => {
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'New Street 9, 1020 Wien',
      deliveryApartment: 'Top 1',
      addressChoice: 'addr_new',
      specialRequests: 'Leave at door',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe('New Street 9, 1020 Wien');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 1');
  expect(ref.set).toHaveBeenCalledWith({
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'New Street 9, 1020 Wien',
      deliveryApartment: 'Top 1',
      addressChoice: 'addr_new',
      specialRequests: 'Leave at door',
    },
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_addresses stashes review form fields into confirmFlowDraft', async () => {
  const { ref } = mockSession({ confirmFlowDraft: null });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'manage_addresses',
    [F.CUSTOMER_NAME]: 'Sam',
    [F.ORDER_TYPE]: 'delivery',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Edited Street 1, 1010 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 7',
    [F.CHECKOUT_NOTE]: 'Call on arrival',
  });

  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(ref.set).toHaveBeenCalledWith({
    confirmFlowDraft: {
      customerName: 'Sam',
      orderType: 'delivery',
      addressChoice: 'addr_new',
      deliveryAddress: 'Edited Street 1, 1010 Wien',
      deliveryApartment: 'Top 7',
      specialRequests: 'Call on arrival',
    },
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_back keeps a session address that matches lastDeliveryAddress only', async () => {
  const { ref } = mockSession({
    deliveryAddress: `  ${ADDRESS_1.toUpperCase()}  `,
    confirmFlowDraft: null,
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_1.toUpperCase());
  expect(ref.set).toHaveBeenCalledWith({
    confirmFlowDraft: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_back preserves valid draft street and apartment fields', async () => {
  const { ref } = mockSession({
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'Hippgasse 11, 1160 Wien',
      deliveryApartment: 'Top 14',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe('Hippgasse 11, 1160 Wien');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 14');
  expect(ref.set).toHaveBeenCalledWith({
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'Hippgasse 11, 1160 Wien',
      deliveryApartment: 'Top 14',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
    updatedAt: expect.any(Date),
  }, { merge: true });
});
