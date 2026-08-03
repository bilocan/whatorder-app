jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../intentLearning', () => ({
  lookupLearnedIntent: jest.fn().mockResolvedValue(null),
  rememberValidatedIntent: jest.fn(),
  rememberValidatedLlmIntent: jest.fn(),
  buildBasketPendingLearning: jest.fn().mockReturnValue(null),
  commitBasketPendingLearning: jest.fn(),
}));
jest.mock('../../lib/llm', () => ({
  canCallLlm: jest.fn().mockReturnValue(false),
  parseOrderIntentWithLlm: jest.fn().mockResolvedValue(null),
  parseProposalEditWithLlm: jest.fn().mockResolvedValue(null),
  parseBotCommandWithLlm: jest.fn().mockResolvedValue(null),
}));
jest.mock('../sessionStore', () => {
  const actual = jest.requireActual('../sessionStore');
  return {
    ...actual,
    getSession: jest.fn(),
    setSession: jest.fn(),
    clearSession: jest.fn(),
    patchSession: jest.fn(),
  };
});
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');
jest.mock('../../lib/geocode');
jest.mock('../../lib/stripe', () => ({
  isStripeConfigured: jest.fn(() => true),
  getStripe: jest.fn(),
}));
jest.mock('../../lib/paymentService', () => ({
  createCheckoutSessionForOrder: jest.fn(),
}));

const mockOrderUpdate = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/collections', () => ({
  customersRef: jest.fn(),
  ordersRef: jest.fn(() => ({
    doc: jest.fn(() => ({ update: mockOrderUpdate })),
    limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: [] }) })),
  })),
}));

const { handleMessage } = require('../botHandler');
const { getSession } = require('../sessionStore');
const { getMenu, getMenuContext, getBusinessInfo, resolvePhotoUrl } = require('../menuService');
const { createOrder, getLastOrderForCustomer, getOrder, cancelOrder, amendOrderAddItems } = require('../orderService');
const {
  sendText, sendListMessage, sendButtonMessage, sendCtaUrlMessage,
  sendFlowMessage, sendLocationRequest, sendImage,
} = require('../../lib/whatsapp');
const { reverseGeocode } = require('../../lib/geocode');
const { customersRef } = require('../../lib/collections');
const { createCheckoutSessionForOrder } = require('../../lib/paymentService');
const { t } = require('../templates');

const BIZ = 'biz_test';
const ROUTING = { businessIds: [BIZ], defaultBusinessId: BIZ, phoneNumberId: 'test_phone_id' };
const FROM = '+43699000001';

const COMPLETE_LEGAL = {
  legalName: 'Gus Partners GmbH',
  street: 'Kupetzkygasse 16',
  zip: '1220',
  city: 'Wien',
  country: 'AT',
  uid: 'ATU81252038',
};

const MENU_WITH_VAT = [
  { id: 'item_1', name: 'Döner', price: 8.5, category: 'mains', vatRate: 10, available: true },
  { id: 'item_2', name: 'Ayran', price: 2, category: 'drinks', vatRate: 20, available: true },
];

const PAY_INFO = {
  name: 'Döner Palace',
  avgPrepTime: 20,
  alertPhone: '+43699123456',
  address: 'Musterstrasse 1, 1010 Wien',
  conversationalBasket: false,
  paymentEnabled: true,
  legal: COMPLETE_LEGAL,
};

const BASKET = [
  { name: 'Döner', qty: 2, price: 8.5 },
  { name: 'Ayran', qty: 1, price: 2, menuItemId: 'item_2' },
];

function confirmingSession(overrides = {}) {
  return {
    language: 'en',
    state: 'confirming',
    businessId: BIZ,
    basket: BASKET,
    customerName: 'John',
    pickupTime: '14:30',
    specialRequests: '',
    ...overrides,
  };
}

function useMenu(menu) {
  getMenu.mockResolvedValue(menu);
  getMenuContext.mockResolvedValue({ menu, menuMatch: null, menuTokenIndex: null });
}

const placeOrderMsg = {
  from: FROM,
  contactName: 'Test User',
  type: 'button_reply',
  id: 'btn_place_order',
  title: 'Confirm ✅',
  text: '',
  items: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  useMenu(MENU_WITH_VAT);
  getBusinessInfo.mockResolvedValue(PAY_INFO);
  createOrder.mockResolvedValue('order_abc123');
  getOrder.mockResolvedValue(null);
  cancelOrder.mockResolvedValue(undefined);
  amendOrderAddItems.mockResolvedValue({ applied: [], total: 0 });
  getLastOrderForCustomer.mockResolvedValue(null);
  resolvePhotoUrl.mockImplementation((url) => url ?? null);
  reverseGeocode.mockResolvedValue(null);
  sendText.mockResolvedValue();
  sendListMessage.mockResolvedValue('list_msg_id');
  sendButtonMessage.mockResolvedValue();
  sendCtaUrlMessage.mockResolvedValue('cta_msg_id');
  sendFlowMessage.mockResolvedValue(null);
  sendLocationRequest.mockResolvedValue();
  sendImage.mockResolvedValue('map_msg_id');
  createCheckoutSessionForOrder.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_1', sessionId: 'cs_1' });
  customersRef.mockReturnValue({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false, data: () => null }),
    }),
  });
});

describe('Stripe checkout gates on legal profile and VAT', () => {
  test('places a card order with a VAT snapshot enriched from the live menu', async () => {
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      paymentMethod: 'stripe',
      taxSnapshot: expect.objectContaining({
        totalsByVat: {
          10: { net: 15.45, vat: 1.55, gross: 17 },
          20: { net: 1.67, vat: 0.33, gross: 2 },
        },
        totalGross: 19,
      }),
    }));
    const { taxSnapshot } = createOrder.mock.calls[0][1];
    expect(taxSnapshot.items).toEqual([
      expect.objectContaining({ name: 'Döner', qty: 2, price: 8.5, vatRate: 10, net: 15.45, vat: 1.55, gross: 17 }),
      expect.objectContaining({ name: 'Ayran', qty: 1, price: 2, vatRate: 20, net: 1.67, vat: 0.33, gross: 2 }),
    ]);
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: 'https://checkout.stripe.com/pay/cs_1',
    }), 'test_phone_id');
  });

  test('includes the delivery fee in the snapshot at 10%', async () => {
    getBusinessInfo.mockResolvedValue({ ...PAY_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue(confirmingSession({
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));

    await handleMessage(ROUTING, placeOrderMsg);

    const { taxSnapshot } = createOrder.mock.calls[0][1];
    expect(taxSnapshot.totalGross).toBeCloseTo(21.5, 5);
    expect(taxSnapshot.totalsByVat[10].gross).toBeCloseTo(19.5, 5);
    expect(taxSnapshot.items).toHaveLength(3);
  });

  test('falls back to cash when the legal profile is incomplete', async () => {
    getBusinessInfo.mockResolvedValue({ ...PAY_INFO, legal: { ...COMPLETE_LEGAL, uid: '' } });
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'cash' }));
    expect(createCheckoutSessionForOrder).not.toHaveBeenCalled();
    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
  });

  test('blocks the card order when a basket line has no VAT rate on the menu', async () => {
    useMenu([{ ...MENU_WITH_VAT[0], vatRate: undefined }, MENU_WITH_VAT[1]]);
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).not.toHaveBeenCalled();
    expect(createCheckoutSessionForOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentVatIncomplete', 'en'), 'test_phone_id');
  });

  test('cash orders are unaffected by missing VAT rates', async () => {
    useMenu([{ ...MENU_WITH_VAT[0], vatRate: undefined }, MENU_WITH_VAT[1]]);
    getBusinessInfo.mockResolvedValue({ ...PAY_INFO, paymentEnabled: false });
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'cash' }));
    const { taxSnapshot } = createOrder.mock.calls[0][1];
    expect(taxSnapshot).toBeNull();
  });
});

describe('payment gate locale keys', () => {
  test.each(['de', 'en', 'tr'])('%s defines the soft error strings', (lang) => {
    const locale = require(`../locales/${lang}`);
    expect(typeof locale.paymentLegalIncomplete).toBe('function');
    expect(typeof locale.paymentVatIncomplete).toBe('function');
    expect(t('paymentLegalIncomplete', lang)).not.toMatch(/^\[/);
    expect(t('paymentVatIncomplete', lang)).not.toMatch(/^\[/);
  });
});
