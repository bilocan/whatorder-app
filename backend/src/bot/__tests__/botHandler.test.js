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
  getMenu,
  getMenuContext,
  getBusinessInfo,
  resolvePhotoUrl,
  createOrder,
  getLastOrderForCustomer,
  sendText,
  sendListMessage,
  sendButtonMessage,
  sendFlowMessage,
  sendLocationRequest,
  sendImage,
  sendCtaUrlMessage,
  reverseGeocode,
  customersRef,
  BIZ,
  ROUTING,
  FROM,
  MENU,
  BEILAGEN_WITH_CHILI,
  BIZ_INFO,
  ROUTING_MULTI,
  BIZ_A_INFO,
  BIZ_B_INFO,
  BASE_SESSION,
  ADDR_CHOICE_SESSION,
  mockCustomerProfile,
  msg,
  expectOrderEntryPrompt,
  makeUpdatedAt,
  multiSession,
  resetBotHandlerMocks,
  clearBotHandlerEnv,
} = require('./helpers/botHandlerTestFixtures');

beforeEach(resetBotHandlerMocks);
afterEach(clearBotHandlerEnv);

describe('Full flow: language detection → catalog → cart → name → confirm → order', () => {

  test('Step 1: first message triggers language detection and shows order entry prompt', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expectOrderEntryPrompt();
  });

  test('Step 2: cart_submitted skips notes and moves straight to awaiting_name (no known name)', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing' });

    await handleMessage(ROUTING, msg({
      type: 'cart_submitted',
      items: [{ productId: 'item_1', qty: 2, price: 8.50, currency: 'EUR' }],
    }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: expect.any(String),
      prepMins: 20,
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('Step 3: user sends name → shows final confirm list with order-type row when delivery enabled', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_name', orderType: 'pickup',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ text: 'Ahmet' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Ahmet',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Ahmet'),
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'btn_place_order' }),
            expect.objectContaining({ id: 'confirm_edit_order_type' }),
            expect.objectContaining({ id: 'confirm_edit_name' }),
            expect.objectContaining({ id: 'btn_add_note' }),
            expect.objectContaining({ id: 'btn_back_to_cart' }),
          ]),
        }),
      ]),
    }));
  });

  test('Step 3: user sends name → confirm list omits order-type row when delivery disabled', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: false });
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_name',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ text: 'Ahmet' }));

    const listCall = sendListMessage.mock.calls.find(([to]) => to === FROM);
    const rows = listCall?.[1]?.sections?.[0]?.rows ?? [];
    expect(rows.some(r => r.id === 'confirm_edit_order_type')).toBe(false);
  });

  test('Step 4: btn_place_order creates order with notes and sends confirmation', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'confirming',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
      specialRequests: 'Extra spicy',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      customerName: 'Ahmet',
      items: [{ name: 'Döner', qty: 2, price: 8.50 }],
      total: 17,
      pickupTime: '14:30',
      notes: 'Extra spicy',
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'), 'test_phone_id');
  });

});

describe('Language detection', () => {
  test.each([
    ['Hallo, ich möchte bestellen', 'de'],
    ['Hello, I want to order',      'en'],
    ['Merhaba sipariş vermek',      'tr'],
  ])('"%s" detects language "%s"', async (text, expectedLang) => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: expectedLang }));
  });

  test('non-text first message uses botLanguage from business (not text-detect)', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ type: 'image', text: undefined }));

    // BIZ_INFO.botLanguage = 'de', so non-text first message defaults to 'de'
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
  });

  test('non-text first message uses botLanguage "en" when configured', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, botLanguage: 'en' });
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ type: 'image', text: undefined }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'en' }));
  });

  test('mid-conversation re-detect updates language when score >= 2', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    // German text with 3 clear DE keywords — should flip to 'de'
    await handleMessage(ROUTING, msg({ text: 'Hallo ich möchte bestellen bitte' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
  });

  test('mid-conversation re-detect does NOT update language on weak signal (score < 2)', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    // 'naber' is TR (score TR:1), 'ja' is DE (score DE:1) — tie, no change; not order-like text
    await handleMessage(ROUTING, msg({ text: 'naber ja' }));

    // Re-detect didn't flip language (stays tr)
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
  });
});

describe('Edge cases', () => {
  test('empty cart_submitted shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'cart_submitted', items: [] }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ textMenuIndex: expect.any(Array) }));
  });

  test('no WHATSAPP_FLOW_ID falls back to order entry on first message', async () => {
    delete process.env.WHATSAPP_FLOW_ID;
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expectOrderEntryPrompt();
    expect(sendFlowMessage).not.toHaveBeenCalled();
  });

  test('unknown productId falls back to productId as name', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({
      type: 'cart_submitted',
      items: [{ productId: 'unknown_99', qty: 1, price: 5.00, currency: 'EUR' }],
    }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'unknown_99', qty: 1, price: 5.00 }],
    }));
  });

  test('default text in browsing state shows order entry prompt', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ text: 'something random' }));

    expectOrderEntryPrompt();
  });

  test('flow failure falls back to order entry on first message', async () => {
    sendFlowMessage.mockRejectedValue(new Error('API error'));
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expectOrderEntryPrompt();
  });
});

describe('Deep link: returning customer (single restaurant)', () => {
  test('ORDER deep link does not run menu search on token text', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: `ORDER ${BIZ}` }));

    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('sonuç yok'));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('No results'));
  });

  test('QR deep link entry shows restaurant-branded order entry prompt', async () => {
    getSession.mockResolvedValue({});
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: `ORDER ${BIZ}` }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_INFO.name),
    }));
  });
});

// ─── Use case: post-order routing (language set, no businessId) ───────────────

describe('Language override via keyword', () => {
  test('"english" switches session language to en', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'english' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'en' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('English'));
  });

  test('"deutsch" switches session language to de', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'deutsch' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Deutsch'));
  });
});

// ─── Empty menu ───────────────────────────────────────────────────────────────

describe('Empty menu', () => {
  test('shows order entry when no items and customer types unknown item', async () => {
    getBusinessInfo.mockResolvedValue({ name: 'Empty Bistro', avgPrepTime: 20 });
    getMenu.mockResolvedValue([]);
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'anything' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('anything'),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });
});
