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
  const getSession = jest.fn();
  const setSession = jest.fn();
  const clearSession = jest.fn();
  const patchSession = jest.fn(async (phone, overrides = {}, baseSession = null) => {
    const fresh = await getSession(phone);
    const merged = baseSession ? { ...baseSession, ...fresh } : { ...fresh };
    const payload = { ...overrides };
    if ('menuId' in payload) {
      payload.pendingDeleteIds = payload.menuId ? [payload.menuId] : [];
      delete payload.menuId;
    }
    await setSession(phone, actual.buildSessionWrite(merged, payload));
  });
  return { ...actual, getSession, setSession, clearSession, patchSession };
});
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');
jest.mock('../../lib/geocode');
jest.mock('../../lib/collections', () => ({
  customersRef: jest.fn(),
  ordersRef: jest.fn(() => ({
    limit: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    })),
  })),
}));

const {
  handleMessage,
  getSession,
  patchSession,
  getBusinessInfo,
  getOrder,
  cancelOrder,
  amendOrderAddItems,
  getLastOrderForCustomer,
  sendText,
  BIZ,
  ROUTING,
  FROM,
  BIZ_INFO,
  msg,
  resetBotHandlerMocks,
  clearBotHandlerEnv,
} = require('./helpers/botHandlerTestFixtures');

const ORDER_ID = 'order_abc123456789';
const POST_ORDER_SESSION = {
  language: 'de',
  state: 'browsing',
  businessId: BIZ,
  basket: [],
  pendingAmendOrderId: ORDER_ID,
  pendingAmendPlacedAt: Date.now(),
  whatsappPhoneNumberId: 'test_phone_id',
};

beforeEach(resetBotHandlerMocks);
afterEach(clearBotHandlerEnv);

describe('M4 post-order routing', () => {
  beforeEach(() => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
  });

  test('status question replies before browsing intent', async () => {
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending' });

    await handleMessage(ROUTING, msg({ text: 'wo bleibt meine bestellung' }));

    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('456789'),
      'test_phone_id',
    );
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  test('cancel request in amend window cancels pending cash order', async () => {
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      paymentMethod: 'cash',
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });
    cancelOrder.mockResolvedValue(undefined);

    await handleMessage(ROUTING, msg({ text: 'stornieren' }));

    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID);
    expect(patchSession).toHaveBeenCalled();
  });

  test('card order add-on gets call-restaurant reply', async () => {
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      paymentMethod: 'stripe',
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein ayran' }));

    expect(amendOrderAddItems).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining(BIZ_INFO.alertPhone),
      'test_phone_id',
    );
  });

  test('cash add-on in amend window amends order', async () => {
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder
      .mockResolvedValueOnce({
        id: ORDER_ID,
        status: 'pending',
        paymentMethod: 'cash',
        items: [{ name: 'Döner', qty: 1, price: 8.5 }],
      })
      .mockResolvedValueOnce({
        id: ORDER_ID,
        status: 'pending',
        paymentMethod: 'cash',
        items: [
          { name: 'Döner', qty: 1, price: 8.5 },
          { name: 'Ayran', qty: 1, price: 2 },
        ],
        total: 10.5,
      });
    amendOrderAddItems.mockResolvedValue({
      applied: [{ name: 'Ayran', qty: 1, price: 2 }],
      total: 10.5,
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein ayran' }));

    expect(amendOrderAddItems).toHaveBeenCalledWith(BIZ, ORDER_ID, expect.any(Array));
    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('456789'),
      'test_phone_id',
    );
  });

  test('approved order modify attempt gets call-restaurant reply', async () => {
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'approved',
      paymentMethod: 'cash',
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein ayran' }));

    expect(amendOrderAddItems).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining(BIZ_INFO.alertPhone),
      'test_phone_id',
    );
  });

  test('human handoff button notifies customer', async () => {
    getSession.mockResolvedValue({
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [],
      whatsappPhoneNumberId: 'test_phone_id',
    });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_human_handoff', title: 'Hilfe' }));

    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining('Restaurant'),
      'test_phone_id',
    );
    expect(sendText).toHaveBeenCalledWith(
      BIZ_INFO.alertPhone,
      expect.stringContaining('Customer needs help'),
      'test_phone_id',
    );
  });
});
