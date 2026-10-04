jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/collections');
jest.mock('../../bot/menuService');
jest.mock('../../bot/customerAddresses');
jest.mock('../../bot/customerLanguage', () => ({
  ...jest.requireActual('../../bot/customerLanguage'),
  setPreferredLanguage: jest.fn().mockResolvedValue(undefined),
  getPreferredLanguage: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bot/resolveTypedDeliveryAddress', () => ({
  resolveTypedDeliveryAddress: jest.fn(async (raw) => ({
    ok: true,
    building: String(raw || '').trim(),
    lat: null,
    lng: null,
  })),
  shouldConfirmDeliveryBuilding: jest.fn(() => false),
}));
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
  saveCustomerName,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
} = require('../../bot/customerAddresses');
const { setPreferredLanguage } = require('../../bot/customerLanguage');
const {
  resolveTypedDeliveryAddress,
  shouldConfirmDeliveryBuilding,
} = require('../../bot/resolveTypedDeliveryAddress');
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
  resolveTypedDeliveryAddress.mockImplementation(async (raw) => ({
    ok: true,
    building: String(raw || '').trim(),
    lat: null,
    lng: null,
  }));
  shouldConfirmDeliveryBuilding.mockReturnValue(false);
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
    customerName: 'Alex',
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
  expect(response.data[F.MANAGE_ADDRESS_CHOICE]).toBe('');
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS].map((option) => option.id))
    .toEqual(['addr_0', 'addr_1', 'addr_new']);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.LANGUAGE_CHOICE]).toBe('en');
  expect(response.data[F.LANGUAGE_OPTIONS].map((option) => option.id)).toEqual(['de', 'en', 'tr']);
  expect(response.data[F.LANGUAGE_OPTIONS].every((option) => option.image && option['alt-text'])).toBe(true);
  expect(response.data[F.UI_LANGUAGE_LABEL]).toBe('Language');
});

test('set_language updates session language and returns to review', async () => {
  const { ref } = mockSession({ language: 'en' });
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'set_language',
    [F.LANGUAGE_CHOICE]: 'tr',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(setPreferredLanguage).toHaveBeenCalledWith(PHONE, 'tr');
  expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({ language: 'tr' }), { merge: true });
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.UI_PLACE_ORDER]).toMatch(/Sipariş/i);
});

test('single layout set_language stays on CHECKOUT_REVIEW in review mode', async () => {
  mockSession({ language: 'en' });
  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'set_language',
    [F.LANGUAGE_CHOICE]: 'de',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(setPreferredLanguage).toHaveBeenCalledWith(PHONE, 'de');
  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('review');
  expect(response.data[F.UI_PLACE_ORDER]).toMatch(/Bestellung/i);
});

test('single layout profile and cart updates stay on CHECKOUT_REVIEW', async () => {
  const layout = { checkout_layout: 'single', [F.CHECKOUT_UI_MODE]: 'review' };
  const opened = await exchange(S.CHECKOUT_REVIEW, {
    ...layout,
    checkout_action: 'manage_addresses',
  });
  expect(opened.screen).toBe(S.CHECKOUT_REVIEW);
  expect(opened.data[F.CHECKOUT_UI_MODE]).toBe('manage');
  expect(opened.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(opened.data[F.UI_SCREEN_TITLE]).toBe(opened.data[F.UI_MANAGE_SCREEN_TITLE]);

  const back = await exchange(S.CHECKOUT_REVIEW, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
  });
  expect(back.screen).toBe(S.CHECKOUT_REVIEW);
  expect(back.data[F.CHECKOUT_UI_MODE]).toBe('review');

  const openedAgain = await exchange(S.CHECKOUT_REVIEW, {
    ...layout,
    checkout_action: 'manage_addresses',
  });
  expect(openedAgain.screen).toBe(S.CHECKOUT_REVIEW);
  expect(openedAgain.data[F.CHECKOUT_UI_MODE]).toBe('manage');

  const cart = await exchange(S.CHECKOUT_REVIEW, {
    ...layout,
    checkout_action: 'open_cart',
    [F.ORDER_TYPE]: 'delivery',
    [F.CHECKOUT_NOTE]: 'Ring',
  });
  expect(cart.screen).toBe(S.CHECKOUT_REVIEW);
  expect(cart.data[F.CHECKOUT_UI_MODE]).toBe('cart');
  expect(cart.data[F.SUBTOTAL_LABEL]).not.toContain('\n');
  expect(cart.data[F.SUBTOTAL_LABEL]).toContain(' · ');

  mockSession({ basket: [{ name: 'Burger', qty: 2, price: 10 }] });
  const removed = await exchange(S.CHECKOUT_REVIEW, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'cart',
    checkout_action: 'cart_remove',
    [F.REMOVE_ITEMS]: ['0'],
    [F.REMOVE_MODE]: 'one',
  });
  expect(removed.screen).toBe(S.CHECKOUT_REVIEW);
  expect(removed.data[F.CHECKOUT_UI_MODE]).toBe('cart');
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

test('select_order_type after a blank manage_back does not restore a saved address', async () => {
  const { ref, session } = mockSession({
    deliveryAddress: null,
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      specialRequests: 'Ring twice',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1],
    lastDeliveryAddress: ADDRESS_1,
    customerName: 'Alex',
  });

  const back = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.MANAGE_ADDRESS_CHOICE]: '',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });
  expect(back.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(back.data[F.ADDRESS_CHOICE]).toBe('addr_new');

  const savedDraft = ref.set.mock.calls
    .map(([patch]) => patch.confirmFlowDraft)
    .find((draft) => draft && Object.prototype.hasOwnProperty.call(draft, 'addressChoice'));
  mockSession({
    ...session,
    deliveryAddress: null,
    confirmFlowDraft: savedDraft,
  });

  const pickup = await exchange(S.CHECKOUT_REVIEW, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'review',
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: back.data[F.ADDRESS_CHOICE],
    [F.DELIVERY_ADDRESS]: back.data[F.DELIVERY_ADDRESS],
    [F.DELIVERY_APARTMENT]: back.data[F.DELIVERY_APARTMENT],
  });

  expect(pickup.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(pickup.data[F.ADDRESS_CHOICE]).toBe('addr_new');
});

test('select_order_type does not restore a stale draft street when the order has no address', async () => {
  mockSession({
    deliveryAddress: null,
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      orderType: 'delivery',
      addressChoice: 'addr_0',
      deliveryAddress: ADDRESS_1,
      deliveryApartment: 'Top 14',
    },
  });

  const pickup = await exchange(S.CHECKOUT_REVIEW, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'review',
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(pickup.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(pickup.data[F.ADDRESS_CHOICE]).toBe('addr_new');

  const delivery = await exchange(S.CHECKOUT_REVIEW, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'review',
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.ADDRESS_CHOICE]: pickup.data[F.ADDRESS_CHOICE],
    [F.DELIVERY_ADDRESS]: pickup.data[F.DELIVERY_ADDRESS],
    [F.DELIVERY_APARTMENT]: pickup.data[F.DELIVERY_APARTMENT],
  });

  expect(delivery.data[F.ORDER_TYPE]).toBe('delivery');
  expect(delivery.data[F.ADDRESS_CHOICE]).toBe('addr_new');
  expect(delivery.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(delivery.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe('No address yet.');
  expect(delivery.data[F.PLACE_ORDER_ENABLED]).toBe(false);
});

test('select_order_type keeps a cleared Neue Adresse through pickup and delivery', async () => {
  const cleared = {
    orderType: 'delivery',
    addressChoice: 'addr_new',
    deliveryAddress: '',
    deliveryApartment: '',
  };
  mockSession({
    orderType: 'delivery',
    deliveryAddress: null,
    confirmFlowDraft: cleared,
  });
  const pickup = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'select_order_type',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
    [F.ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(pickup.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(pickup.data[F.ADDRESS_CHOICE]).toBe('addr_new');

  mockSession({
    orderType: 'pickup',
    deliveryAddress: null,
    confirmFlowDraft: { ...cleared, orderType: 'pickup' },
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
  expect(delivery.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(delivery.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe('No address yet.');
  expect(delivery.data[F.PLACE_ORDER_ENABLED]).toBe(false);
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
  expect(response.data[F.RECEIPT_TEXT]).toContain('Delivery fee:');
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBeTruthy();
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

test('select_order_type delivery below minimum stays on review with the footer off', async () => {
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

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.ORDER_TYPE]).toBe('delivery');
  expect(response.data[F.PLACE_ORDER_ENABLED]).toBe(false);
  expect(response.data[F.CHECKOUT_BLOCK_VISIBLE]).toBe(true);
  expect(response.data[F.CHECKOUT_BLOCK_REASON]).toContain('Minimum order €10.00');
  expect(response.data[F.UI_REVIEW_INTRO]).toBe('Demo Kitchen');
  expect(ref.set).toHaveBeenCalledWith(expect.objectContaining({
    confirmFlowDraft: expect.objectContaining({ orderType: 'delivery' }),
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

test('select_address on manage opens the edit form', async () => {
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
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
});

test('select_address Neue Adresse opens empty edit form', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'select_address',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
  });

  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.MANAGE_ADDRESS_CHOICE]).toBe('addr_new');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
});

test('select_address Neue Adresse keeps a name typed on Profil', async () => {
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [],
    lastDeliveryAddress: null,
    customerName: null,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'select_address',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.CUSTOMER_NAME]: 'Enes Yildirim',
  });

  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.CUSTOMER_NAME]).toBe('Enes Yildirim');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
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
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    orderType: 'delivery',
  });
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: '',
    [F.DELIVERY_APARTMENT]: '',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe(ADDRESS_2);
  // One Speichern returns to review with the selected address applied.
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    { merge: true },
  );
});

test('manage_save keep with full courier label in Straße still applies selected row', async () => {
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: ADDRESS_1,
      deliveryApartment: 'Top 14',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    // Prefill puts the full label in Straße (fieldsForAddressChoice).
    [F.DELIVERY_ADDRESS]: ADDRESS_2,
    [F.DELIVERY_APARTMENT]: 'Top 2',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe(ADDRESS_2);
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    { merge: true },
  );
});

test('manage_save on a saved row with inputs matching that label writes nothing', async () => {
  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
    [F.DELIVERY_ADDRESS]: 'Hippgasse 11, 1160 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 14',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
});

test('manage_save from ADDRESS_MANAGE_UPDATED still returns to review with selected address', async () => {
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    orderType: 'delivery',
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE_UPDATED, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: ADDRESS_2,
    [F.DELIVERY_APARTMENT]: 'Top 2',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe(ADDRESS_2);
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    { merge: true },
  );
});

test('manage_save new address stays on the profile list and leaves the order address', async () => {
  const novel = 'Brandgasse 8, Top 1, 1020 Wien';
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    orderType: 'delivery',
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2, novel],
    // New row is saved but OptIn was off — default stays ADDRESS_1.
    lastDeliveryAddress: ADDRESS_1,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE_UPDATED, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Brandgasse 8, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 1',
  });

  expect(saveCustomerAddress).toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: novel }),
    { merge: true },
  );
});

test('manage_save new address with no order address stays on the list for Zurück', async () => {
  const { ref } = mockSession({
    deliveryAddress: '',
    orderType: 'delivery',
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: ['Brandgasse 8, Top 1, 1020 Wien'],
    lastDeliveryAddress: null,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Brandgasse 8, 1020 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 1',
  });

  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({ pendingOrderAddress: 'Brandgasse 8, Top 1, 1020 Wien' }),
    { merge: true },
  );
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: expect.any(String) }),
    { merge: true },
  );
});

test('manage_save keep treats Haus as matching a building-only saved label', async () => {
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: ['Aspernstraße 6, 1220 Wien', ADDRESS_2],
    lastDeliveryAddress: 'Aspernstraße 6, 1220 Wien',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
    [F.DELIVERY_ADDRESS]: 'Aspernstraße 6, 1220 Wien',
    [F.DELIVERY_APARTMENT]: 'Haus',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
});

test('select_address refills Haus for a building-only saved row', async () => {
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: ['Aspernstraße 6, 1220 Wien', ADDRESS_2],
    lastDeliveryAddress: 'Aspernstraße 6, 1220 Wien',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'select_address',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe('Aspernstraße 6, 1220 Wien');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Haus');
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
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
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
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
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
});

test('manage_delete stays on the profile list and does not replace the order address', async () => {
  const { ref } = mockSession({
    deliveryAddress: 'Hippgasse 11, 1160 Wien',
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
    savedAddresses: [ADDRESS_1],
    lastDeliveryAddress: ADDRESS_1,
  });

  const response = await exchange(S.ADDRESS_MANAGE_UPDATED, {
    checkout_action: 'manage_delete',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
  });

  expect(deleteCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_2,
    retainLabels: [ADDRESS_1],
  });
  expect(response.screen).toBe(S.ADDRESS_MANAGE_UPDATED);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.UI_MANAGE_HINT]).toBe('Saved addresses (1/5)');
  expect(response.data[F.MANAGE_ADDRESS_OPTIONS]).toHaveLength(2);
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    expect.anything(),
  );
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_1 }),
    expect.anything(),
  );
});

test('manage_delete clears the order address when that row is the one removed', async () => {
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: ADDRESS_1,
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

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_delete',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('manage');
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.UI_MANAGE_HINT]).toBe('Saved addresses (1/5)');
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryAddress: null,
      confirmFlowDraft: expect.objectContaining({
        customerName: 'Alex',
        specialRequests: 'Ring twice',
      }),
    }),
    { merge: true },
  );
  const clearedDraft = ref.set.mock.calls
    .map(([patch]) => patch.confirmFlowDraft)
    .find((draft) => draft && draft.customerName === 'Alex');
  expect(clearedDraft.deliveryAddress).toBeUndefined();
  expect(clearedDraft.deliveryApartment).toBeUndefined();
});

test('manage_delete keeps only the rows that were on screen', async () => {
  const visible = [
    ADDRESS_2,
    'Street 3, Top 3, 1030 Wien',
    'Street 4, Top 4, 1040 Wien',
    'Street 5, Top 5, 1050 Wien',
  ];
  const hidden = 'Hidden Street 9, Top 1, 1010 Wien';
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1, ...visible, hidden],
    lastDeliveryAddress: ADDRESS_1,
    customerName: 'Alex',
  });
  deleteCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: visible,
    lastDeliveryAddress: visible[0],
  });

  await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_delete',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_0',
  });

  expect(deleteCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_1,
    retainLabels: visible,
  });
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
    retainLabels: [],
  });
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.UI_MANAGE_HINT]).toBe('Saved addresses (0/5)');
});

test('manage_back with an empty address book drops a leftover order address', async () => {
  const { ref } = mockSession({
    deliveryAddress: null,
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: 'Lavaterstraße 3, 1220 Wien',
      deliveryApartment: '',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [],
    lastDeliveryAddress: null,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('review');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe('No address yet.');
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryAddress: null,
      confirmFlowDraft: expect.objectContaining({
        customerName: 'Alex',
        specialRequests: 'Ring twice',
      }),
    }),
    { merge: true },
  );
  const clearedDraft = ref.set.mock.calls
    .map(([patch]) => patch.confirmFlowDraft)
    .find((draft) => draft && draft.customerName === 'Alex');
  expect(clearedDraft.deliveryAddress).toBeUndefined();
  expect(clearedDraft.addressChoice).toBeUndefined();
});

test('manage_back after deleting the order address does not fill the first saved row', async () => {
  const { ref } = mockSession({
    deliveryAddress: null,
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      specialRequests: 'Ring twice',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_2, ADDRESS_1],
    lastDeliveryAddress: ADDRESS_2,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.MANAGE_ADDRESS_CHOICE]: '',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('review');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe('No address yet.');
  expect(response.data[F.PLACE_ORDER_ENABLED]).toBe(false);
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    expect.anything(),
  );
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_1 }),
    expect.anything(),
  );
});

test('manage_confirm_accept remembers a saved address when the order has none', async () => {
  const saved = 'Lavaterstraße 3, Top 4, 1220 Wien';
  const { ref } = mockSession({
    deliveryAddress: null,
    orderType: 'delivery',
    confirmFlowDraft: { customerName: 'Alex', orderType: 'delivery' },
    flowManageAddressConfirm: {
      label: saved,
      choice: 'addr_new',
      setDefault: false,
    },
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [saved],
    lastDeliveryAddress: null,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_confirm_accept',
  });

  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('manage');
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(ref.set).toHaveBeenCalledWith({
    pendingOrderAddress: saved,
    updatedAt: expect.any(Date),
  }, { merge: true });
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: saved }),
    expect.anything(),
  );
});

test('manage_back puts a just-saved address on an empty order', async () => {
  const saved = 'Lavaterstraße 3, Top 4, 1220 Wien';
  const { ref } = mockSession({
    deliveryAddress: null,
    orderType: 'delivery',
    pendingOrderAddress: saved,
    confirmFlowDraft: {
      customerName: 'Alex',
      specialRequests: 'Ring twice',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [saved, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_2,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.MANAGE_ADDRESS_CHOICE]: '',
  });

  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('review');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(saved);
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe(saved);
  expect(response.data[F.PLACE_ORDER_ENABLED]).toBe(true);
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryAddress: saved,
      pendingOrderAddress: null,
    }),
    { merge: true },
  );
});

test('manage_back applies the selected saved address on review', async () => {
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: ADDRESS_1,
      deliveryApartment: 'Top 14',
      addressChoice: 'addr_0',
      specialRequests: 'Ring twice',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_2);
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe(ADDRESS_2);
  expect(response.data[F.ORDER_TYPE]).toBe('delivery');
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryAddress: ADDRESS_2,
      orderType: 'delivery',
    }),
    { merge: true },
  );
});

test('manage_back leaves the order address when the star differs and no row is selected', async () => {
  const { ref } = mockSession({
    deliveryAddress: ADDRESS_1,
    orderType: 'delivery',
    confirmFlowDraft: {
      customerName: 'Alex',
      deliveryAddress: ADDRESS_1,
      addressChoice: 'addr_0',
    },
  });
  loadCustomerAddresses.mockResolvedValue({
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_2,
    customerName: 'Alex',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_1);
  expect(response.data[F.DELIVERY_ADDRESS_DISPLAY]).toBe(ADDRESS_1);
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    expect.anything(),
  );
});

test('manage_back on Abholung does not force Lieferung or sticky delivery address', async () => {
  const { ref } = mockSession({
    orderType: 'pickup',
    deliveryAddress: null,
    confirmFlowDraft: { customerName: 'Alex', orderType: 'pickup' },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'pickup',
  });

  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.ORDER_TYPE]).toBe('pickup');
  expect(response.data[F.ADDRESS_FIELDS_VISIBLE]).toBe(false);
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ orderType: 'delivery' }),
    expect.anything(),
  );
});

test('manage_back saves profile name and shows it on review', async () => {
  saveCustomerName.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2],
    lastDeliveryAddress: ADDRESS_1,
    customerName: 'Sam',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_back',
    [F.CUSTOMER_NAME]: 'Sam',
  });

  expect(saveCustomerName).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    name: 'Sam',
  });
  expect(response.screen).toBe(S.CHECKOUT_REVIEW_RETURN);
  expect(response.data[F.CUSTOMER_NAME]).toBe('Sam');
  expect(response.data[F.CUSTOMER_NAME_DISPLAY]).toBe('Sam');
});

test('manage_back clears an order address that is no longer in the book', async () => {
  const { ref } = mockSession({
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
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryAddress: null,
      confirmFlowDraft: expect.objectContaining({
        customerName: 'Alex',
        deliveryAddress: '',
        specialRequests: 'Ring twice',
      }),
    }),
    { merge: true },
  );
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ deliveryAddress: ADDRESS_2 }),
    expect.anything(),
  );
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
    flowManageAddressConfirm: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
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

test('manage_save with corrected address stays on the form and shows the found line', async () => {
  const { ref } = mockSession();
  shouldConfirmDeliveryBuilding.mockReturnValue(true);
  resolveTypedDeliveryAddress.mockResolvedValue({
    ok: true,
    building: 'Lavaterstraße 3, Top 4, 1220 Wien',
    lat: 48.2,
    lng: 16.4,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'lavaterstrasse 3 1220',
    [F.DELIVERY_APARTMENT]: 'Top 4',
    [F.MANAGE_SET_AS_DEFAULT]: true,
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('lavaterstrasse 3 1220');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 4');
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(true);
  expect(response.data[F.MANAGE_FOUND_LINE]).toBe('Found: Lavaterstraße 3, Top 4, 1220 Wien');
  expect(response.data[F.MANAGE_FOUND_APPLY]).toBe(false);
  expect(response.data[F.UI_MANAGE_SAVE]).toBe('Save this address');
  expect(ref.set).toHaveBeenCalledWith({
    flowManageAddressConfirm: {
      label: 'Lavaterstraße 3, Top 4, 1220 Wien',
      typed: 'lavaterstrasse 3 1220, Top 4',
      choice: 'addr_new',
      setDefault: true,
      street: 'lavaterstrasse 3 1220',
      apartment: 'Top 4',
      appliedStreet: 'Lavaterstraße 3, 1220 Wien',
      applied: false,
    },
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_save keeps a typed unit when Google returns the building only', async () => {
  shouldConfirmDeliveryBuilding.mockReturnValue(false);
  resolveTypedDeliveryAddress.mockResolvedValue({
    ok: true,
    building: 'Lavaterstraße 3, 1220 Wien',
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: ['Lavaterstraße 3, Top 4, 1220 Wien'],
    lastDeliveryAddress: null,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Lavaterstrasse 3, 1220',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: 'Lavaterstraße 3, Top 4, 1220 Wien',
    replaceLabel: null,
  });
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
});

test('found line keeps a typed unit when Google returns the building only', async () => {
  shouldConfirmDeliveryBuilding.mockReturnValue(true);
  resolveTypedDeliveryAddress.mockResolvedValue({
    ok: true,
    building: 'Lavaterstraße 3, 1220 Wien',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'lavaterstrasse 3, 1220',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.data[F.MANAGE_FOUND_LINE]).toBe('Found: Lavaterstraße 3, Top 4, 1220 Wien');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 4');
});

test('apply_found writes the corrected street and keeps Wohnung', async () => {
  mockSession({
    flowManageAddressConfirm: {
      label: 'Hippgasse 11, 1160 Wien',
      choice: 'addr_new',
      street: 'Hipgasse 11',
      apartment: 'Haus',
      appliedStreet: 'Hippgasse 11, 1160 Wien',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'apply_found',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Hipgasse 11',
    [F.DELIVERY_APARTMENT]: 'Haus',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe('Hippgasse 11, 1160 Wien');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Haus');
  expect(response.data[F.MANAGE_FOUND_APPLY]).toBe(true);
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(true);
});

test('apply_found again restores the typed street', async () => {
  mockSession({
    flowManageAddressConfirm: {
      label: 'Hippgasse 11, 1160 Wien',
      choice: 'addr_new',
      street: 'Hipgasse 11',
      apartment: 'Haus',
      appliedStreet: 'Hippgasse 11, 1160 Wien',
      applied: true,
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'apply_found',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Hippgasse 11, 1160 Wien',
    [F.DELIVERY_APARTMENT]: 'Haus',
  });

  expect(response.data[F.DELIVERY_ADDRESS]).toBe('Hipgasse 11');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Haus');
  expect(response.data[F.MANAGE_FOUND_APPLY]).toBe(false);
});

test('manage_save without the found checkbox does not write the address', async () => {
  mockSession({
    flowManageAddressConfirm: {
      label: 'Lavaterstraße 3, Top 4, 1220 Wien',
      choice: 'addr_new',
      setDefault: false,
      street: 'lavaterstrasse 3 1220',
      apartment: 'Top 4',
      appliedStreet: 'Lavaterstraße 3, 1220 Wien',
      applied: false,
    },
  });
  shouldConfirmDeliveryBuilding.mockReturnValue(true);
  resolveTypedDeliveryAddress.mockResolvedValue({
    ok: true,
    building: 'Lavaterstraße 3, Top 4, 1220 Wien',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'lavaterstrasse 3 1220',
    [F.DELIVERY_APARTMENT]: 'Top 4',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(true);
  expect(response.data[F.MANAGE_FOUND_APPLY]).toBe(false);
});

test('manage_save with a changed street resolves again instead of the old find', async () => {
  mockSession({
    flowManageAddressConfirm: {
      label: 'Aspernstraße 6, 3442 Langenrohr',
      choice: 'addr_new',
      street: 'asparnstrasse 6',
      apartment: 'haus',
      applied: false,
    },
  });
  shouldConfirmDeliveryBuilding.mockReturnValue(false);
  resolveTypedDeliveryAddress.mockResolvedValue({
    ok: true,
    building: 'Aspernstraße 6, 1220 Wien',
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: ['Aspernstraße 6, 1220 Wien'],
    lastDeliveryAddress: null,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'asparnstrasse 6, 1220',
    [F.DELIVERY_APARTMENT]: 'haus',
    [F.MANAGE_FOUND_APPLY]: false,
  });

  expect(saveCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: 'Aspernstraße 6, 1220 Wien',
    replaceLabel: null,
  });
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
});

test('select_address drops a pending find so Löschen can delete that row', async () => {
  const { ref } = mockSession({
    flowManageAddressConfirm: {
      label: 'Aspernstraße 6, 3442 Langenrohr',
      choice: 'addr_new',
      street: 'asparnstrasse 6',
      apartment: 'haus',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'select_address',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: 'asparnstrasse 6',
    [F.DELIVERY_APARTMENT]: 'haus',
  });

  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(false);
  expect(response.data[F.DELIVERY_ADDRESS]).toBe(ADDRESS_2);
  expect(ref.set).toHaveBeenCalledWith({
    flowManageAddressConfirm: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_edit_link deletes when the open row is not the pending find', async () => {
  deleteCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1],
    lastDeliveryAddress: ADDRESS_1,
  });
  mockSession({
    flowManageAddressConfirm: {
      label: 'Aspernstraße 6, 3442 Langenrohr',
      choice: 'addr_new',
      street: 'asparnstrasse 6',
      apartment: 'haus',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_edit_link',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_1',
    [F.DELIVERY_ADDRESS]: ADDRESS_2,
    [F.DELIVERY_APARTMENT]: 'Top 2',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(deleteCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: ADDRESS_2,
    retainLabels: [ADDRESS_1],
  });
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
});

test('opening Profil drops a pending find', async () => {
  const { ref } = mockSession({
    flowManageAddressConfirm: {
      label: 'Aspernstraße 6, 3442 Langenrohr',
      choice: 'addr_new',
      street: 'asparnstrasse 6',
      apartment: 'haus',
    },
  });

  const response = await exchange(S.CHECKOUT_REVIEW, {
    checkout_action: 'manage_addresses',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(false);
  expect(ref.set).toHaveBeenCalledWith({
    flowManageAddressConfirm: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_edit_link clears a pending find and the address fields', async () => {
  const { ref } = mockSession({
    flowManageAddressConfirm: {
      label: 'Aspernstraße 6, 3442 Langenrohr',
      choice: 'addr_new',
      street: 'asparnstrasse 6',
      apartment: 'haus',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_edit_link',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'asparnstrasse 6',
    [F.DELIVERY_APARTMENT]: 'haus',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(false);
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('');
  expect(response.data[F.MANAGE_ADDRESS_CHOICE]).toBe('addr_new');
  expect(ref.set).toHaveBeenCalledWith({
    flowManageAddressConfirm: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
});

test('manage_save after the found checkbox stores the found address', async () => {
  mockSession({
    flowManageAddressConfirm: {
      label: 'Lavaterstraße 3, Top 4, 1220 Wien',
      choice: 'addr_new',
      setDefault: false,
      street: 'lavaterstrasse 3 1220',
      apartment: 'Top 4',
      appliedStreet: 'Lavaterstraße 3, 1220 Wien',
      applied: false,
    },
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2, 'Lavaterstraße 3, Top 4, 1220 Wien'],
    lastDeliveryAddress: ADDRESS_1,
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'lavaterstrasse 3 1220',
    [F.DELIVERY_APARTMENT]: 'Top 4',
    [F.MANAGE_FOUND_APPLY]: true,
  });

  expect(resolveTypedDeliveryAddress).not.toHaveBeenCalled();
  expect(saveCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: 'Lavaterstraße 3, Top 4, 1220 Wien',
    replaceLabel: null,
  });
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.MANAGE_FOUND_VISIBLE]).toBe(false);
});

test('manage_save with unverifiable address shows invalid error on edit', async () => {
  resolveTypedDeliveryAddress.mockResolvedValue({ ok: false });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_save',
    [F.MANAGE_ADDRESS_CHOICE]: 'addr_new',
    [F.DELIVERY_ADDRESS]: 'Nowhere 999, 1010 Wien',
    [F.DELIVERY_APARTMENT]: 'Top 1',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.ERROR_VISIBLE]).toBe(true);
  expect(response.data[F.ERROR_MESSAGE]).toMatch(/could not verify/i);
});

test('manage_confirm_accept saves the pending normalized label', async () => {
  const { ref } = mockSession({
    flowManageAddressConfirm: {
      label: 'Lavaterstraße 3, Top 4, 1220 Wien',
      choice: 'addr_new',
      setDefault: true,
      street: 'lavaterstrasse 3 1220',
      apartment: 'Top 4',
    },
  });
  saveCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2, 'Lavaterstraße 3, Top 4, 1220 Wien'],
    lastDeliveryAddress: ADDRESS_1,
  });
  setDefaultCustomerAddress.mockResolvedValue({
    ok: true,
    savedAddresses: [ADDRESS_1, ADDRESS_2, 'Lavaterstraße 3, Top 4, 1220 Wien'],
    lastDeliveryAddress: 'Lavaterstraße 3, Top 4, 1220 Wien',
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_layout: 'single',
    [F.CHECKOUT_UI_MODE]: 'manage',
    checkout_action: 'manage_confirm_accept',
    [F.CUSTOMER_NAME]: 'Alex',
  });

  expect(saveCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: 'Lavaterstraße 3, Top 4, 1220 Wien',
    replaceLabel: null,
  });
  expect(setDefaultCustomerAddress).toHaveBeenCalledWith({
    phone: PHONE,
    businessId: BUSINESS_ID,
    label: 'Lavaterstraße 3, Top 4, 1220 Wien',
  });
  expect(ref.set).toHaveBeenCalledWith({
    flowManageAddressConfirm: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
  expect(ref.set).not.toHaveBeenCalledWith(
    expect.objectContaining({
      deliveryAddress: expect.anything(),
    }),
    { merge: true },
  );
  expect(response.screen).toBe(S.CHECKOUT_REVIEW);
  expect(response.data[F.CHECKOUT_UI_MODE]).toBe('manage');
  expect(response.data[F.MANAGE_UI_MODE]).toBe('list');
  expect(response.data[F.CUSTOMER_NAME]).toBe('Alex');
});

test('manage_confirm_reject returns to edit with original fields', async () => {
  const { ref } = mockSession({
    flowManageAddressConfirm: {
      label: 'Lavaterstraße 3, Top 4, 1220 Wien',
      choice: 'addr_new',
      setDefault: false,
      street: 'lavaterstrasse 3 1220',
      apartment: 'Top 4',
    },
  });

  const response = await exchange(S.ADDRESS_MANAGE, {
    checkout_action: 'manage_confirm_reject',
  });

  expect(saveCustomerAddress).not.toHaveBeenCalled();
  expect(ref.set).toHaveBeenCalledWith({
    flowManageAddressConfirm: null,
    updatedAt: expect.any(Date),
  }, { merge: true });
  expect(response.screen).toBe(S.ADDRESS_MANAGE);
  expect(response.data[F.MANAGE_UI_MODE]).toBe('edit');
  expect(response.data[F.DELIVERY_ADDRESS]).toBe('lavaterstrasse 3 1220');
  expect(response.data[F.DELIVERY_APARTMENT]).toBe('Top 4');
  expect(response.data[F.MANAGE_ADDRESS_CHOICE]).toBe('addr_new');
});
