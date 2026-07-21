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

describe('Browsing state: conversational basket (Tier 5)', () => {
  test('flag on — cola raus with stale pending proposal edits basket not proposal', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
        { id: 'a1', name: 'Ayran', price: 2, available: true },
      ],
      menuMatch: require('../menuMapper').buildMenuMatchIndex([
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
        { id: 'a1', name: 'Ayran', price: 2, available: true },
      ]),
      menuTokenIndex: null,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Cola', qty: 1, price: 2.50 },
      ],
      pendingIntentItems: [
        { name: 'Döner', qty: 2, menuItemId: 'd1', price: 8.5 },
        { name: 'Ayran', qty: 1, menuItemId: 'a1', price: 2 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'cola raus' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pendingIntentItems: undefined,
    }), expect.anything());
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_intent_confirm' }),
      ]),
    }));
  });

  test('flag on — ohne ayran removes from committed basket without Entfernen tap', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Ayran', qty: 1, price: 2.00 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'ohne ayran' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pendingIntentItems: undefined,
    }), expect.anything());
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Verstanden'),
    }));
  });

  test('flag on — mach 2 döner re-quantifies without confirm tap', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'mach 2 döner' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    }), expect.anything());
  });

  test('flag on + LLM enabled — warenkorb shows basket instead of parse-failed', async () => {
    const { canCallLlm } = require('../../lib/llm');
    canCallLlm.mockReturnValue(true);
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'warenkorb' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
    }));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringMatching(/Konnte die Bestellung nicht verstehen/i));
    canCallLlm.mockReturnValue(false);
  });

  test('flag on — front-loaded delivery phrase sets slots and shows food proposal', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      conversationalBasket: true,
      deliveryEnabled: true,
      deliveryFee: 2.5,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ, basket: [],
    });

    await handleMessage(ROUTING, msg({ text: '2 döner zum Liefern, Hauptstraße 5' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
    }), expect.anything());
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_intent_confirm' }),
      ]),
    }));
  });

  test('flag on — two unparseable order-like messages offer human handoff', async () => {
    let stored = {
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [],
      whatsappPhoneNumberId: 'test_phone_id',
      consecutiveParseFailures: 0,
    };
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getSession.mockImplementation(async () => ({ ...stored }));
    setSession.mockImplementation(async (_phone, data) => { stored = { ...data }; });
    getLastOrderForCustomer.mockResolvedValue(null);

    await handleMessage(ROUTING, msg({ text: 'flibberty gibberish nonsense' }));

    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_human_handoff' }),
      ]),
    }));
    expect(stored.consecutiveParseFailures).toBe(1);

    await handleMessage(ROUTING, msg({ text: 'xyzzy qwerty plugh' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_human_handoff' }),
      ]),
    }), 'test_phone_id');
    expect(sendText).toHaveBeenCalledWith(
      BIZ_INFO.alertPhone,
      expect.stringContaining('Customer needs help'),
      'test_phone_id',
    );
    expect(stored.consecutiveParseFailures).toBe(2);
  });
});

describe('Layer 0: reorder-first for returning customers', () => {
  const LAST_ORDER = {
    items: [{ name: 'Döner', qty: 2, price: 8.5 }, { name: 'Ayran', qty: 1, price: 2.0 }],
    status: 'delivered',
    createdAt: { toMillis: () => Date.now() },
  };

  test('first message shows reorder prompt when order history exists', async () => {
    getLastOrderForCustomer.mockResolvedValue(LAST_ORDER);
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hallo' }));

    expect(getLastOrderForCustomer).toHaveBeenCalledWith(BIZ, FROM);
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_reorder_confirm' }),
        expect.objectContaining({ id: 'btn_reorder_browse' }),
      ]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('explicit new order text skips reorder and uses intent parser', async () => {
    getLastOrderForCustomer.mockResolvedValue(LAST_ORDER);
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: '2x döner 1 ayran' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_intent_confirm' }),
      ]),
    }));
  });

  test('greeting mid-conversation (already browsing, empty basket) shows reorder prompt with restaurant name, not "undefined"', async () => {
    getLastOrderForCustomer.mockResolvedValue(LAST_ORDER);
    getSession.mockResolvedValue({
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [],
    });

    await handleMessage(ROUTING, msg({ text: 'Hallo' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_INFO.name),
    }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('undefined'),
    }));
  });

  test('btn_reorder_confirm loads last order into basket', async () => {
    getSession.mockResolvedValue({
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [],
      pendingReorderItems: [{ name: 'Döner', qty: 2, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_reorder_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 2, price: 8.5 }],
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });

  test('btn_reorder_browse opens catalog instead', async () => {
    getSession.mockResolvedValue({
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [],
      pendingReorderItems: [{ name: 'Döner', qty: 2, price: 8.5 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_reorder_browse' }));

    expect(sendListMessage).toHaveBeenCalled();
  });
});

describe('Layer 1: disambiguation for ambiguous item names', () => {
  const AMBIG_MENU = [
    { id: 'd1', name: 'Döner', price: 8.5, category: 'mains', available: true },
    { id: 'd2', name: 'Döner Box', price: 9.5, category: 'mains', available: true },
    { id: 'd3', name: 'Döner Teller', price: 11, category: 'mains', available: true },
    { id: 'item_2', name: 'Ayran', price: 2, category: 'drinks', available: true },
  ];

  beforeEach(() => {
    getMenu.mockResolvedValue(AMBIG_MENU);
  });

  test('single-word döner shows disambiguation list', async () => {
    getSession.mockResolvedValue({ language: 'de', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'döner' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'disamb_d1' }),
          expect.objectContaining({ id: 'disamb_d2' }),
        ]),
      })],
    }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_disamb_each' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'disambiguating_intent' }));
  });

  test('2x döner asks same-or-each then picks one by one', async () => {
    const KEBAP_AMBIG = [
      { id: 'd1', name: 'Adana Kebap', price: 9.5, category: 'Kebap', available: true },
      { id: 'd2', name: 'Urfa Kebap', price: 9.5, category: 'Kebap', available: true },
    ];
    getMenu.mockResolvedValue(KEBAP_AMBIG);

    let liveSession = { language: 'tr', state: 'browsing', businessId: BIZ, basket: [] };
    getSession.mockImplementation(() => Promise.resolve({ ...liveSession }));
    setSession.mockImplementation(async (_phone, data) => {
      liveSession = { ...data };
    });

    await handleMessage(ROUTING, msg({ text: '2 döner' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_disamb_same' }),
        expect.objectContaining({ id: 'btn_disamb_each' }),
      ]),
    }));

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_disamb_each' }));

    expect(sendListMessage).toHaveBeenLastCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/1\/2/),
    }));

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'disamb_d1' }));

    expect(sendListMessage).toHaveBeenLastCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/2\/2/),
    }));

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'disamb_d2' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Adana Kebap'),
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_intent_confirm' })]),
    }));
    expect(liveSession.pendingIntentItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Adana Kebap', qty: 1 }),
      expect.objectContaining({ name: 'Urfa Kebap', qty: 1 }),
    ]));
  });

  test('menu keyword opens full catalog', async () => {
    getSession.mockResolvedValue({ language: 'de', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'menü' }));

    expect(sendListMessage).toHaveBeenCalled();
  });

  test('typed cola pick during disambiguation completes intent proposal', async () => {
    const COLA_MENU = [
      { id: 'd1', name: 'Döner', price: 8.5, category: 'mains', available: true },
      { id: 'item_2', name: 'Ayran', price: 2, category: 'drinks', available: true },
      { id: 'cola_033', name: 'Coca Cola 0.33L', price: 2.9, category: 'drinks', available: true },
      { id: 'cola_05', name: 'Coca Cola 0.5L', price: 3.5, category: 'drinks', available: true },
    ];
    getMenu.mockResolvedValue(COLA_MENU);

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'disambiguating_intent',
      businessId: BIZ,
      basket: [],
      disambiguation: {
        rawName: 'cola',
        qty: 1,
        candidates: [
          { id: 'cola_033', name: 'Coca Cola 0.33L', price: 2.9 },
          { id: 'cola_05', name: 'Coca Cola 0.5L', price: 3.5 },
        ],
        resolvedMatched: [
          { menuItemId: 'd1', name: 'Döner', qty: 2, price: 8.5, optionGroups: [] },
          { menuItemId: 'item_2', name: 'Ayran', qty: 1, price: 2, optionGroups: [] },
        ],
        unmatchedSoFar: [],
        pendingRest: [],
      },
    });

    await handleMessage(ROUTING, msg({ text: 'Coca Cola 0.33L €2.90' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Coca Cola 0.33L'),
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_intent_confirm' })]),
    }));
    const proposalWrite = setSession.mock.calls.find(
      ([, data]) => data.pendingIntentItems?.some(i => i.name === 'Coca Cola 0.33L'),
    );
    expect(proposalWrite).toBeDefined();
    expect(proposalWrite[1]).not.toHaveProperty('disambiguation');
    expect(proposalWrite[1].state).toBe('browsing');
  });

  test('confirm works when proposal pending but state stuck on disambiguating_intent', async () => {
    getSession.mockResolvedValue({
      language: 'tr',
      state: 'disambiguating_intent',
      businessId: BIZ,
      basket: [],
      disambiguation: { rawName: 'cola', qty: 1, candidates: [] },
      pendingIntentItems: [
        { menuItemId: 'd1', name: 'Döner', qty: 2, price: 8.5, optionGroups: [] },
        { menuItemId: 'item_2', name: 'Ayran', qty: 1, price: 2, optionGroups: [] },
        { menuItemId: 'cola_033', name: 'Coca Cola 0.33L', qty: 1, price: 2.9, optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/eklendi/),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_view_basket' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
    const confirmWrite = setSession.mock.calls.find(
      ([, data]) => data.basket?.some(i => i.name === 'Döner' && i.qty === 2),
    );
    expect(confirmWrite).toBeDefined();
    expect(confirmWrite[1].state).toBe('browsing');
    expect(confirmWrite[1]).not.toHaveProperty('pendingIntentItems');
  });

  test('iptal during disambiguation clears flow', async () => {
    getSession.mockResolvedValue({
      language: 'tr',
      state: 'disambiguating_intent',
      businessId: BIZ,
      basket: [],
      disambiguation: {
        rawName: 'cola',
        qty: 1,
        candidates: [{ id: 'cola_033', name: 'Coca Cola 0.33L', price: 2.9 }],
        resolvedMatched: [],
        pendingRest: [],
      },
    });

    await handleMessage(ROUTING, msg({ text: 'iptal' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_search' }),
        expect.objectContaining({ id: 'btn_view_full_menu' }),
      ]),
    }));
    const clearedWrite = setSession.mock.calls.find(([, data]) => !data.disambiguation && !data.pendingIntentItems);
    expect(clearedWrite).toBeDefined();
  });

  test('new order text during disambiguation re-runs intent (learned phrase)', async () => {
    const { lookupLearnedIntent } = require('../intentLearning');
    const SANDWICH_MENU = [
      { id: 'ss1', name: 'Schnitzel Sandwich', price: 7.5, category: 'mains', available: true },
      { id: 'ss2', name: 'Schnitzel Teller', price: 11, category: 'mains', available: true },
      { id: 'cola_033', name: 'Coca Cola 0.33L', price: 2.9, category: 'drinks', available: true },
    ];
    getMenu.mockResolvedValue(SANDWICH_MENU);
    lookupLearnedIntent.mockResolvedValueOnce({
      items: [
        { name: 'Schnitzel Sandwich', qty: 1, menuItemId: 'ss1' },
        { name: 'Coca Cola 0.33L', qty: 1, menuItemId: 'cola_033' },
      ],
      partySize: null,
      operation: 'add',
    });

    getSession.mockResolvedValue({
      language: 'de',
      state: 'disambiguating_intent',
      businessId: BIZ,
      basket: [],
      disambiguation: {
        rawName: 'schnitzel semmel',
        qty: 1,
        candidates: [
          { id: 'ss1', name: 'Schnitzel Sandwich', price: 7.5 },
          { id: 'ss2', name: 'Schnitzel Teller', price: 11 },
        ],
        resolvedMatched: [],
        pendingRest: [{ name: 'cola', qty: 1 }],
      },
    });

    await handleMessage(ROUTING, msg({ text: 'schnitzel semmel und cola' }));

    expect(lookupLearnedIntent).toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Schnitzel Sandwich'),
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_intent_confirm' })]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
    const proposalWrite = setSession.mock.calls.find(
      ([, data]) => data.pendingIntentItems?.some(i => i.name === 'Schnitzel Sandwich'),
    );
    expect(proposalWrite).toBeDefined();
    expect(proposalWrite[1]).not.toHaveProperty('disambiguation');
  });

  test('unique new order during disambiguation escapes to proposal', async () => {
    getSession.mockResolvedValue({
      language: 'de',
      state: 'disambiguating_intent',
      businessId: BIZ,
      basket: [],
      disambiguation: {
        rawName: 'döner',
        qty: 1,
        candidates: [
          { id: 'd1', name: 'Döner', price: 8.5 },
          { id: 'd2', name: 'Döner Box', price: 9.5 },
          { id: 'd3', name: 'Döner Teller', price: 11 },
        ],
        resolvedMatched: [],
        pendingRest: [],
      },
    });

    await handleMessage(ROUTING, msg({ text: '1 ayran' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Ayran'),
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_intent_confirm' })]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('start during disambiguation clears to order entry', async () => {
    getSession.mockResolvedValue({
      language: 'de',
      state: 'disambiguating_intent',
      businessId: BIZ,
      basket: [],
      disambiguation: {
        rawName: 'döner',
        qty: 1,
        candidates: [
          { id: 'd1', name: 'Döner', price: 8.5 },
          { id: 'd2', name: 'Döner Box', price: 9.5 },
        ],
        resolvedMatched: [],
        pendingRest: [],
      },
    });

    await handleMessage(ROUTING, msg({ text: 'start' }));

    // botHandler GREETING_FRESH_START_STATES exits disambiguation before the state handler.
    expectOrderEntryPrompt();
    expect(sendListMessage).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(
      FROM,
      expect.objectContaining({ state: 'browsing', basket: [] }),
    );
  });
});
