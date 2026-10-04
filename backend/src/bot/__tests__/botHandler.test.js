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
jest.mock('../customerLanguage', () => ({
  ...jest.requireActual('../customerLanguage'),
  getPreferredLanguage: jest.fn().mockResolvedValue(null),
  setPreferredLanguage: jest.fn().mockResolvedValue(undefined),
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
jest.mock('../../lib/stripe', () => ({
  isStripeConfigured: jest.fn(() => true),
  getStripe: jest.fn(),
}));
jest.mock('../../lib/paymentService', () => ({
  createCheckoutSessionForOrder: jest.fn(),
}));
jest.mock('../../lib/collections', () => ({
  customersRef: jest.fn(),
  customerPrefsRef: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }), set: jest.fn().mockResolvedValue(undefined) })),
  menuRef: jest.fn(),
  ordersRef: jest.fn(() => ({
    doc: jest.fn(() => ({ update: jest.fn().mockResolvedValue(undefined) })),
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
  CARD_READY_BIZ,
  useMenuWithVat,
  ROUTING_MULTI,
  BIZ_A_INFO,
  BIZ_B_INFO,
  BASE_SESSION,
  ADDR_CHOICE_SESSION,
  mockCustomerProfile,
  msg,
  expectOrderEntryPrompt,
  expectCatalogPrompt,
  makeUpdatedAt,
  multiSession,
  resetBotHandlerMocks,
  clearBotHandlerEnv,
} = require('./helpers/botHandlerTestFixtures');
const { menuRef } = require('../../lib/collections');
const { createCheckoutSessionForOrder } = require('../../lib/paymentService');
const { getPreferredLanguage, setPreferredLanguage } = require('../customerLanguage');

beforeEach(() => {
  resetBotHandlerMocks();
  useMenuWithVat(menuRef);
  createCheckoutSessionForOrder.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_1', sessionId: 'cs_1' });
});
afterEach(clearBotHandlerEnv);

describe('Full flow: language detection → catalog → cart → name → confirm → order', () => {

  test('Step 1: first message asks for language; button pick opens catalog', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_language', language: null }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_lang_tr' }),
      ]),
    }));

    getSession.mockResolvedValue({ state: 'awaiting_language', language: null, basket: [], businessId: null });
    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_lang_tr' }));

    expect(setPreferredLanguage).toHaveBeenCalledWith(FROM, 'tr');
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expectCatalogPrompt();
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

  test('Step 4: btn_place_order creates Stripe order with notes and sends pay link', async () => {
    getBusinessInfo.mockResolvedValue(CARD_READY_BIZ);
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
      paymentMethod: 'stripe',
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: 'https://checkout.stripe.com/pay/cs_1',
    }), 'test_phone_id');
  });

});

describe('Language picker', () => {
  test.each([
    ['btn_lang_de', 'de'],
    ['btn_lang_en', 'en'],
    ['btn_lang_tr', 'tr'],
  ])('%s sets preferred language %s and opens catalog', async (buttonId, expectedLang) => {
    getSession.mockResolvedValue({ state: 'awaiting_language', language: null, basket: [], businessId: null });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: buttonId }));

    expect(setPreferredLanguage).toHaveBeenCalledWith(FROM, expectedLang);
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: expectedLang, state: 'browsing' }));
    expectCatalogPrompt();
  });

  test('first message without preferred language shows picker (not auto-detect)', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hallo, ich möchte bestellen' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_lang_de' }),
        expect.objectContaining({ id: 'btn_lang_en' }),
        expect.objectContaining({ id: 'btn_lang_tr' }),
      ]),
    }));
    expect(sendFlowMessage).not.toHaveBeenCalled();
  });

  test('returning customer with preferredLanguage skips picker', async () => {
    getPreferredLanguage.mockResolvedValue('tr');
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expectCatalogPrompt();
  });

  test('stuck awaiting_language with preferredLanguage resumes without re-showing picker', async () => {
    getPreferredLanguage.mockResolvedValue('tr');
    getSession.mockResolvedValue({
      state: 'awaiting_language',
      language: null,
      basket: [],
      businessId: null,
      pendingDeepBid: null,
    });

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_lang_de' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expectCatalogPrompt();
  });

  test('stuck awaiting_language with preferredLanguage + pendingDeepBid resumes deep link', async () => {
    getPreferredLanguage.mockResolvedValue('de');
    getSession.mockResolvedValue({
      state: 'awaiting_language',
      language: null,
      basket: [],
      businessId: null,
      pendingDeepBid: BIZ,
    });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: 'hi' }));

    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_lang_de' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      language: 'de',
      businessId: BIZ,
      pendingDeepBid: null,
    }));
  });

  test('cart_submitted during awaiting_language is not blocked by language gate', async () => {
    getSession.mockResolvedValue({
      state: 'awaiting_language',
      language: null,
      basket: [],
      businessId: BIZ,
    });

    await handleMessage(ROUTING, msg({
      type: 'cart_submitted',
      items: [{ productId: 'item_1', qty: 1, price: 8.50, currency: 'EUR' }],
    }));

    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_lang_de' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([
        expect.objectContaining({ name: 'Döner', qty: 1 }),
      ]),
    }));
  });

  test('re-prompt while awaiting_language preserves basket via patchSession', async () => {
    const basket = [{ name: 'Döner', qty: 1, price: 8.5 }];
    getSession.mockResolvedValue({
      state: 'awaiting_language',
      language: null,
      basket,
      businessId: BIZ,
      pendingDeepBid: null,
    });

    await handleMessage(ROUTING, msg({ text: 'hi' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_lang_de' }),
      ]),
    }));
    // Full wipe would call setSession with basket: []; re-prompt must keep items.
    const wipeCalls = setSession.mock.calls.filter(([, data]) => (
      data?.state === 'awaiting_language' && Array.isArray(data.basket) && data.basket.length === 0
    ));
    expect(wipeCalls).toHaveLength(0);
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_language',
      basket,
      businessId: BIZ,
    }));
  });

  test('mid-conversation re-detect updates language when score >= 2 and no preferredLanguage', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'Hallo ich möchte bestellen bitte' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
  });

  test('preferredLanguage blocks mid-conversation auto re-detect', async () => {
    getPreferredLanguage.mockResolvedValue('tr');
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'Hallo ich möchte bestellen bitte' }));

    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
  });

  test('mid-conversation re-detect does NOT update language on weak signal (score < 2)', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'naber ja' }));

    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'de' }));
  });
});

describe('DEV flow keyword (DEPLOY_ENV)', () => {
  const prevDeployEnv = process.env.DEPLOY_ENV;

  afterEach(() => {
    if (prevDeployEnv === undefined) delete process.env.DEPLOY_ENV;
    else process.env.DEPLOY_ENV = prevDeployEnv;
  });

  test('DEPLOY_ENV=test sends Flow on keyword "flow"', async () => {
    process.env.DEPLOY_ENV = 'test';
    process.env.WHATSAPP_MENU_FLOW_ID = 'flow_test_id';
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ });

    await handleMessage(ROUTING, msg({ text: 'flow' }));

    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      flowId: 'flow_test_id',
      flowToken: `${FROM}|${BIZ}`,
      flowAction: 'data_exchange',
    }));
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('DEPLOY_ENV=production ignores keyword "flow"', async () => {
    process.env.DEPLOY_ENV = 'production';
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'flow' }));

    expect(sendFlowMessage).not.toHaveBeenCalled();
  });

  test('flow keyword ignores stale session.businessId not on routing', async () => {
    process.env.DEPLOY_ENV = 'test';
    process.env.WHATSAPP_MENU_FLOW_ID = 'flow_test_id';
    getSession.mockResolvedValue({
      language: 'en',
      state: 'browsing',
      businessId: 'biz_removed',
      basket: [],
    });

    await handleMessage(ROUTING, msg({ text: 'flow' }));

    const expectedBid = ROUTING.defaultBusinessId || ROUTING.businessIds[0];
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      flowToken: `${FROM}|${expectedBid}`,
    }));
    expect(sendFlowMessage.mock.calls[0][1].flowToken).not.toContain('biz_removed');
  });
});

describe('Edge cases', () => {
  test('empty cart_submitted shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'cart_submitted', items: [] }));

    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      flowId: 'flow_test_id',
      flowAction: 'data_exchange',
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('no WHATSAPP_MENU_FLOW_ID falls back to list menu on first message', async () => {
    delete process.env.WHATSAPP_MENU_FLOW_ID;
    delete process.env.WHATSAPP_FLOW_ID;
    getPreferredLanguage.mockResolvedValue('en');
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(sendFlowMessage).not.toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_search' }),
      ]),
    }));
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

  test('flow failure falls back to list menu on first message', async () => {
    sendFlowMessage.mockRejectedValue(new Error('API error'));
    getPreferredLanguage.mockResolvedValue('en');
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_search' }),
      ]),
    }));
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

  test('QR deep link without language stashes bid and shows picker', async () => {
    getSession.mockResolvedValue({});
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: `ORDER ${BIZ}` }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_language',
      pendingDeepBid: BIZ,
    }));
    expect(sendButtonMessage).toHaveBeenCalled();
  });

  test('QR deep link with preferredLanguage opens catalog', async () => {
    getPreferredLanguage.mockResolvedValue('tr');
    getSession.mockResolvedValue({});
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: `ORDER ${BIZ}` }));

    expectCatalogPrompt();
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
