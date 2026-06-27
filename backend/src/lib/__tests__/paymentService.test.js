jest.mock('../collections');
jest.mock('../firebase', () => ({
  admin: { firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'TS') } } },
}));
jest.mock('../stripe');
jest.mock('../feeConfig');
jest.mock('../settlementConfig', () => ({
  getSettlementConfig: jest.fn().mockResolvedValue({
    holdDays: 7,
    payoutWeekday: 2,
    payoutTime: '10:00',
    timezone: 'Europe/Vienna',
    minimumPayoutCents: 2500,
    connectMode: 'mock',
  }),
  computeHoldEndsAt: jest.fn((d, c) => new Date(d.getTime() + (c?.holdDays ?? 7) * 86400000)),
  computeExpectedPayoutAt: jest.fn((d) => new Date(d.getTime() + 86400000)),
}));
jest.mock('../whatsapp', () => ({ sendText: jest.fn().mockResolvedValue('msg_1') }));
jest.mock('../whatsappReturn', () => ({
  resolveWhatsAppReturnPhoneDigits: jest.fn().mockResolvedValue('436601234567'),
  waMeUrl: jest.fn((d) => (d ? `https://wa.me/${d}` : null)),
}));
jest.mock('../whatsappRouting', () => jest.requireActual('../whatsappRouting'));
jest.mock('../../bot/templates', () => ({ t: jest.fn((_k, _lang, shortId) => `paid:${shortId}`) }));

const { ordersRef, stripeEventRef } = require('../collections');
const { getStripe } = require('../stripe');
const { getFeeConfig, calcFeeCents } = require('../feeConfig');
const { sendText } = require('../whatsapp');
const {
  createCheckoutSessionForOrder,
  handleCheckoutSessionCompleted,
  processStripeWebhookEvent,
  paymentBaseUrl,
} = require('../paymentService');

const mockOrderUpdate = jest.fn();
const mockOrderGet = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BACKEND_URL = 'http://localhost:3000';
  ordersRef.mockReturnValue({
    doc: jest.fn(() => ({ get: mockOrderGet, update: mockOrderUpdate })),
  });
  stripeEventRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({ exists: false }),
    set: jest.fn().mockResolvedValue(),
  });
  getFeeConfig.mockResolvedValue({ feeType: 'fixed', feeValue: 0.5 });
  calcFeeCents.mockReturnValue(50);
});

describe('createCheckoutSessionForOrder', () => {
  test('creates checkout session with metadata and EUR amount', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/pay/cs_test' });
    getStripe.mockReturnValue({ checkout: { sessions: { create } } });

    const result = await createCheckoutSessionForOrder('biz1', 'order_abc123', {
      totalEuros: 29,
      restaurantName: 'Döner Palace',
      shortId: 'ABC123',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      metadata: { order_id: 'order_abc123', business_id: 'biz1' },
      line_items: [expect.objectContaining({
        price_data: expect.objectContaining({
          currency: 'eur',
          unit_amount: 2900,
        }),
      })],
    }));
    expect(result).toEqual({ url: 'https://checkout.stripe.com/pay/cs_test', sessionId: 'cs_test' });
  });

  test('throws when Stripe is not configured', async () => {
    getStripe.mockReturnValue(null);
    await expect(createCheckoutSessionForOrder('biz1', 'order_1', { totalEuros: 10, shortId: 'X' }))
      .rejects.toThrow('Stripe is not configured');
  });
});

describe('paymentBaseUrl', () => {
  const prevBackendUrl = process.env.BACKEND_URL;
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.BACKEND_URL = prevBackendUrl;
    process.env.NODE_ENV = prevNodeEnv;
  });

  test('uses BACKEND_URL when set', () => {
    process.env.BACKEND_URL = 'https://api.example.com/';
    expect(paymentBaseUrl()).toBe('https://api.example.com');
  });

  test('defaults to localhost in development', () => {
    delete process.env.BACKEND_URL;
    process.env.NODE_ENV = 'development';
    expect(paymentBaseUrl()).toBe('http://localhost:3000');
  });

  test('throws in production when BACKEND_URL is missing', () => {
    delete process.env.BACKEND_URL;
    process.env.NODE_ENV = 'production';
    expect(() => paymentBaseUrl()).toThrow('BACKEND_URL must be set');
  });
});

describe('handleCheckoutSessionCompleted', () => {
  test('marks order paid with fee split and notifies customer', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({
        paymentStatus: 'pending',
        total: 29,
        customerPhone: '+431234',
        language: 'en',
        whatsappPhoneNumberId: 'prod_phone_id',
      }),
    });

    await handleCheckoutSessionCompleted({
      id: 'cs_1',
      amount_total: 2900,
      payment_intent: 'pi_1',
      metadata: { business_id: 'biz1', order_id: 'order_abc123' },
    });

    expect(mockOrderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      paymentStatus: 'paid',
      paymentMethod: 'stripe',
      grossAmountCents: 2900,
      whatorderFeeCents: 50,
      restaurantNetCents: 2850,
      settlementStatus: 'pending',
    }));
    expect(sendText).toHaveBeenCalledWith('+431234', 'paid:ABC123', 'prod_phone_id');
    expect(mockOrderUpdate).toHaveBeenCalledTimes(2);
    expect(mockOrderUpdate.mock.calls[1][0]).toEqual({ paymentNotifiedAt: 'TS' });
  });

  test('still notifies when order already paid but paymentNotifiedAt missing', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({
        paymentStatus: 'paid',
        customerPhone: '+431234',
        language: 'en',
        whatsappPhoneNumberId: 'prod_phone_id',
      }),
    });

    await handleCheckoutSessionCompleted({
      id: 'cs_1',
      metadata: { business_id: 'biz1', order_id: 'order_abc123' },
    });

    expect(mockOrderUpdate).toHaveBeenCalledTimes(1);
    expect(mockOrderUpdate.mock.calls[0][0]).toEqual({ paymentNotifiedAt: 'TS' });
    expect(sendText).toHaveBeenCalledWith('+431234', 'paid:ABC123', 'prod_phone_id');
  });

  test('skips when payment already notified', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({ paymentStatus: 'paid', paymentNotifiedAt: 'TS' }),
    });

    await handleCheckoutSessionCompleted({
      id: 'cs_1',
      metadata: { business_id: 'biz1', order_id: 'order_1' },
    });

    expect(mockOrderUpdate).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  test('logs error and skips notify when order has no whatsappPhoneNumberId', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({
        paymentStatus: 'pending',
        customerPhone: '+431234',
        language: 'en',
      }),
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await handleCheckoutSessionCompleted({
      id: 'cs_1',
      amount_total: 2900,
      metadata: { business_id: 'biz1', order_id: 'order_abc123' },
    });

    expect(sendText).not.toHaveBeenCalled();
    expect(mockOrderUpdate).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/whatsappPhoneNumberId/));

    errorSpy.mockRestore();
  });
});

describe('processStripeWebhookEvent', () => {
  test('is idempotent for duplicate event IDs', async () => {
    stripeEventRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true }),
      set: jest.fn(),
    });

    const result = await processStripeWebhookEvent({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { object: {} },
    });

    expect(result).toEqual({ duplicate: true });
    expect(mockOrderUpdate).not.toHaveBeenCalled();
  });
});
