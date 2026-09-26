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
  releaseUnpaidCheckoutSession: jest.fn(),
  completePaidCheckoutSession: jest.fn(),
  refundOrderPayment: jest.fn(),
}));

const mockOrderUpdate = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/collections', () => ({
  customersRef: jest.fn(),
  menuRef: jest.fn(),
  ordersRef: jest.fn(() => ({
    doc: jest.fn(() => ({ update: mockOrderUpdate })),
    limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: [] }) })),
  })),
}));

const { handleMessage } = require('../botHandler');
const { getSession, setSession } = require('../sessionStore');
const { getMenu, getMenuContext, getBusinessInfo, resolvePhotoUrl } = require('../menuService');
const { createOrder, getLastOrderForCustomer, getOrder, cancelOrder, amendOrderAddItems } = require('../orderService');
const {
  sendText, sendListMessage, sendButtonMessage, sendCtaUrlMessage,
  sendFlowMessage, sendLocationRequest, sendImage,
} = require('../../lib/whatsapp');
const { reverseGeocode } = require('../../lib/geocode');
const { customersRef, menuRef } = require('../../lib/collections');
const { createCheckoutSessionForOrder, releaseUnpaidCheckoutSession, completePaidCheckoutSession, refundOrderPayment } = require('../../lib/paymentService');
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
  iban: 'AT611904300234573201',
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

/**
 * `getMenu*` feeds ordering/matching (available items only); `menuRef` feeds the VAT join,
 * which reads the raw collection so unavailable items still resolve their rate.
 */
function useMenu(menu, rawMenu = menu) {
  getMenu.mockResolvedValue(menu.filter(i => i.available !== false));
  getMenuContext.mockResolvedValue({
    menu: menu.filter(i => i.available !== false),
    menuMatch: null,
    menuTokenIndex: null,
  });
  menuRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      docs: rawMenu.map(({ id, ...data }) => ({ id, data: () => data })),
    }),
  });
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
  releaseUnpaidCheckoutSession.mockResolvedValue({ paid: false, released: true });
  completePaidCheckoutSession.mockResolvedValue(true);
  refundOrderPayment.mockResolvedValue({ refunded: true, skipped: false });
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
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: t('paymentBackPrompt', 'en'),
      buttons: [{ id: 'btn_payment_back', title: t('paymentBackBtn', 'en') }],
    }), 'test_phone_id');
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: 'https://checkout.stripe.com/pay/cs_1',
    }), 'test_phone_id');
    expect(sendButtonMessage.mock.invocationCallOrder[0]).toBeLessThan(
      sendCtaUrlMessage.mock.invocationCallOrder[0],
    );
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
    // Tagged rather than positional, so persistence can filter the synthetic line.
    expect(taxSnapshot.items[2]).toMatchObject({ name: 'Delivery fee', kind: 'fee', vatRate: 10 });
    expect(taxSnapshot.items.filter(item => item.kind === 'fee')).toHaveLength(1);
  });

  test('joins VAT for a customized line whose name carries option modifiers', async () => {
    getSession.mockResolvedValue(confirmingSession({
      basket: [
        { name: 'Döner — Chicken, Tomato, Salad', qty: 1, price: 9 },
        { name: 'Ayran — Large', qty: 1, price: 2.5 },
      ],
    }));

    await handleMessage(ROUTING, placeOrderMsg);

    expect(sendText).not.toHaveBeenCalledWith(FROM, t('paymentVatIncomplete', 'en'), 'test_phone_id');
    const { taxSnapshot } = createOrder.mock.calls[0][1];
    expect(taxSnapshot.items).toEqual([
      expect.objectContaining({ name: 'Döner — Chicken, Tomato, Salad', vatRate: 10 }),
      expect.objectContaining({ name: 'Ayran — Large', vatRate: 20 }),
    ]);
    expect(createCheckoutSessionForOrder).toHaveBeenCalled();
  });

  test('joins VAT for an item that went unavailable while sitting in the basket', async () => {
    useMenu([{ ...MENU_WITH_VAT[0], available: false }, MENU_WITH_VAT[1]]);
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    const { taxSnapshot } = createOrder.mock.calls[0][1];
    expect(taxSnapshot.items[0]).toMatchObject({ name: 'Döner', vatRate: 10 });
    expect(createCheckoutSessionForOrder).toHaveBeenCalled();
  });

  test('still blocks the card order when a customized line has no menu match at all', async () => {
    getSession.mockResolvedValue(confirmingSession({
      basket: [{ name: 'Mystery Plate — Extra', qty: 1, price: 5 }],
    }));

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentVatIncomplete', 'en'), 'test_phone_id');
  });

  test('blocks the order when the legal profile is incomplete', async () => {
    getBusinessInfo.mockResolvedValue({ ...PAY_INFO, legal: { ...COMPLETE_LEGAL, uid: '' } });
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).not.toHaveBeenCalled();
    expect(createCheckoutSessionForOrder).not.toHaveBeenCalled();
    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentLegalIncomplete', 'en'), 'test_phone_id');
  });

  test('blocks the order when the settlement IBAN is missing', async () => {
    getBusinessInfo.mockResolvedValue({ ...PAY_INFO, legal: { ...COMPLETE_LEGAL, iban: null } });
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).not.toHaveBeenCalled();
    expect(createCheckoutSessionForOrder).not.toHaveBeenCalled();
    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentLegalIncomplete', 'en'), 'test_phone_id');
  });

  test('blocks the card order when a basket line has no VAT rate on the menu', async () => {
    useMenu([{ ...MENU_WITH_VAT[0], vatRate: undefined }, MENU_WITH_VAT[1]]);
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).not.toHaveBeenCalled();
    expect(createCheckoutSessionForOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentVatIncomplete', 'en'), 'test_phone_id');
  });

  test('blocks the order when paymentEnabled is off — no cash fallback', async () => {
    useMenu([{ ...MENU_WITH_VAT[0], vatRate: undefined }, MENU_WITH_VAT[1]]);
    getBusinessInfo.mockResolvedValue({ ...PAY_INFO, paymentEnabled: false });
    getSession.mockResolvedValue(confirmingSession());

    await handleMessage(ROUTING, placeOrderMsg);

    expect(createOrder).not.toHaveBeenCalled();
    expect(createCheckoutSessionForOrder).not.toHaveBeenCalled();
    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentLegalIncomplete', 'en'), 'test_phone_id');
  });
});

describe('unpaid payment back button', () => {
  const placedSession = {
    language: 'en',
    state: 'browsing',
    businessId: BIZ,
    basket: [],
    customerName: 'John',
    whatsappPhoneNumberId: 'test_phone_id',
    pendingAmendOrderId: 'order_abc123',
    pendingAmendBusinessId: BIZ,
    pendingAmendPlacedAt: Date.now(),
  };

  const unpaidOrder = {
    id: 'order_abc123',
    status: 'pending',
    paymentMethod: 'stripe',
    paymentStatus: 'pending',
    paymentStripeSessionId: 'cs_1',
    customerName: 'John',
    customerPhone: FROM,
    orderType: 'pickup',
    notes: 'no onion',
    items: [
      { name: 'Döner', qty: 2, price: 8.5, vatRate: 10, net: 15.45, vat: 1.55, gross: 17 },
      { name: 'Ayran', qty: 1, price: 2, menuItemId: 'item_2', vatRate: 20, net: 1.67, vat: 0.33, gross: 2 },
    ],
  };

  test('withdraws the unpaid order and reopens Bestellung prüfen', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder.mockResolvedValue(unpaidOrder);

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Back',
      text: '',
      items: null,
    });

    expect(releaseUnpaidCheckoutSession).toHaveBeenCalledWith('cs_1');
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, 'order_abc123', {
      skipReentry: true,
      skipCustomerNotify: true,
    });
    expect(sendText).toHaveBeenCalledWith(
      '+43699123456',
      expect.stringContaining('withdrawn before payment'),
      'test_phone_id',
    );
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      businessId: BIZ,
      customerName: 'John',
      orderType: 'pickup',
      specialRequests: 'no onion',
      basket: [
        expect.objectContaining({ name: 'Döner', qty: 2, price: 8.5 }),
        expect.objectContaining({ name: 'Ayran', qty: 1, price: 2, menuItemId: 'item_2' }),
      ],
    }));
    const saved = setSession.mock.calls.at(-1)[1];
    expect(saved.pendingAmendOrderId).toBeUndefined();
    expect(saved.basket[0].vatRate).toBeUndefined();
    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
  });

  test('a second Ändern on an already withdrawn order stays quiet', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce({ ...unpaidOrder, status: 'cancelled' });

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('a second Ändern whose cancel loses the race stays quiet', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce({ ...unpaidOrder, status: 'cancelled' });
    cancelOrder.mockRejectedValue(new Error('Invalid transition: cancelled → cancelled'));

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(sendText).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('a refunded order tells the customer the payment was refunded', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder.mockResolvedValue({ ...unpaidOrder, status: 'cancelled', paymentStatus: 'refunded' });

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentRefunded', 'en', 'ABC123'), 'test_phone_id');
    expect(sendText).not.toHaveBeenCalledWith(FROM, t('paymentBackPaid', 'en', 'ABC123'), 'test_phone_id');
  });

  test('leaves a paid order in place and sends the post-payment messages', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder
      .mockResolvedValueOnce({ ...unpaidOrder, paymentStatus: 'paid', restaurantName: 'enes kebap' })
      .mockResolvedValueOnce({
        ...unpaidOrder,
        paymentStatus: 'paid',
        paymentNotifiedAt: 'TS',
      });

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(releaseUnpaidCheckoutSession).not.toHaveBeenCalled();
    expect(completePaidCheckoutSession).toHaveBeenCalledWith('cs_1');
    expect(sendText).not.toHaveBeenCalledWith(FROM, t('paymentBackPaid', 'en', 'ABC123'), 'test_phone_id');
    expect(setSession).not.toHaveBeenCalled();
  });

  test('repeats the post-order buttons when payment was already announced', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder.mockResolvedValue({
      ...unpaidOrder,
      paymentStatus: 'paid',
      paymentNotifiedAt: 'TS',
      restaurantName: 'enes kebap',
    });

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(completePaidCheckoutSession).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, {
      body: t('postOrderOptions', 'en', 'enes kebap'),
      buttons: [
        { id: 'btn_post_cancel', title: t('postCancelBtn', 'en') },
        { id: 'btn_post_reorder', title: t('postReorderBtn', 'en') },
        { id: 'btn_post_restaurant', title: t('postRestaurantBtn', 'en') },
      ],
    }, 'test_phone_id');
  });

  test('completes a Stripe session that is already paid when Ändern is tapped', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce({ ...unpaidOrder, paymentStatus: 'paid', paymentNotifiedAt: 'TS' });
    releaseUnpaidCheckoutSession.mockResolvedValue({ paid: true, released: false });

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(completePaidCheckoutSession).toHaveBeenCalledWith('cs_1');
    expect(sendText).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('refunds when payment lands between the re-read and cancel', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce({
        ...unpaidOrder,
        status: 'cancelled',
        paymentStatus: 'paid',
        paymentMethod: 'stripe',
      });

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(cancelOrder).toHaveBeenCalledWith(BIZ, 'order_abc123', {
      skipReentry: true,
      skipCustomerNotify: true,
    });
    expect(refundOrderPayment).toHaveBeenCalledWith(BIZ, 'order_abc123', {
      reason: 'withdrawn_before_payment',
      actor: 'customer',
      notifyCustomer: true,
    });
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'confirming' }));
  });

  test('does not reopen Prüfen when that refund fails', async () => {
    getSession.mockResolvedValue(placedSession);
    getOrder
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce(unpaidOrder)
      .mockResolvedValueOnce({ ...unpaidOrder, status: 'cancelled', paymentStatus: 'paid' });
    refundOrderPayment.mockRejectedValue(new Error('stripe down'));

    await handleMessage(ROUTING, {
      from: FROM,
      contactName: 'Test User',
      type: 'button_reply',
      id: 'btn_payment_back',
      title: 'Change',
      text: '',
      items: null,
    });

    expect(sendText).toHaveBeenCalledWith(FROM, t('paymentBackFailed', 'en'), 'test_phone_id');
    expect(setSession).not.toHaveBeenCalled();
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
