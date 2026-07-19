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
  setSession,
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

    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true });
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

  test('order text after placement routes to call-restaurant (add-on removed)', async () => {
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
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

  test('order text after post-order context expires clears stale amend id and falls through', async () => {
    const staleSession = {
      ...POST_ORDER_SESSION,
      pendingAmendPlacedAt: Date.now() - 24 * 60 * 60 * 1000,
    };
    getSession.mockResolvedValue(staleSession);
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'delivered',
      paymentMethod: 'cash',
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ text: '2 döner' }));

    // Not swallowed by the post-order path: no call-restaurant reply, no amend
    expect(amendOrderAddItems).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalledWith(
      FROM,
      expect.stringContaining(BIZ_INFO.alertPhone),
      expect.anything(),
    );
    // Stale amend context is cleared so it cannot hijack future messages
    const [, firstWrite] = setSession.mock.calls[0];
    expect(firstWrite).not.toHaveProperty('pendingAmendOrderId');
    expect(firstWrite).not.toHaveProperty('pendingAmendPlacedAt');
  });

  test('modify text with missing pendingAmendPlacedAt clears stale amend id', async () => {
    getSession.mockResolvedValue({
      ...POST_ORDER_SESSION,
      pendingAmendPlacedAt: undefined,
    });
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      paymentMethod: 'cash',
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein ayran' }));

    expect(amendOrderAddItems).not.toHaveBeenCalled();
    const [, firstWrite] = setSession.mock.calls[0];
    expect(firstWrite).not.toHaveProperty('pendingAmendOrderId');
  });

  test('cancel request after context expiry still gets call-restaurant reply', async () => {
    getSession.mockResolvedValue({
      ...POST_ORDER_SESSION,
      pendingAmendPlacedAt: Date.now() - 24 * 60 * 60 * 1000,
    });
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'delivered',
      paymentMethod: 'cash',
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ text: 'stornieren' }));

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      FROM,
      expect.stringContaining(BIZ_INFO.alertPhone),
      'test_phone_id',
    );
  });

  test('flag off: modify after approve gets call-restaurant reply (row 75)', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: false });
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

  test('flag off: cash add-on in amend window gets call-restaurant reply', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: false });
    getSession.mockResolvedValue(POST_ORDER_SESSION);
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
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
