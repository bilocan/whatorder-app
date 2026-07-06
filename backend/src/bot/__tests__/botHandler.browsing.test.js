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

describe('Selecting state: quantity selection flow', () => {
  const pendingItem = { name: 'Döner', price: 8.50 };

  test('qty button adds item to empty basket and shows post-add buttons', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [],
      pendingItem,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_2', title: '2' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_add_more' }),
        expect.objectContaining({ id: 'btn_view_basket' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });

  test('text number adds item to basket', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'selecting', businessId: BIZ, basket: [],
      pendingItem: { name: 'Ayran', price: 2.00 },
    });

    await handleMessage(ROUTING, msg({ text: '3' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Ayran', qty: 3, price: 2.00 }],
    }));
  });

  test('qty merges into existing basket item', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pendingItem,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    }));
  });

  test('non-numeric text re-shows qty buttons without changing session', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [],
      pendingItem,
    });

    await handleMessage(ROUTING, msg({ text: 'I want one please' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'qty_1' })]),
    }));
  });
});

// ─── Tier A intent ordering ──────────────────────────────────────────────────

describe('Intent ordering (Tier A)', () => {
  test('first message with order text shows intent confirm instead of menu', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: '2x Döner und Ayran' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_intent_confirm' }),
        expect.objectContaining({ id: 'btn_intent_change' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      pendingIntentItems: expect.arrayContaining([
        expect.objectContaining({ name: 'Döner', qty: 2 }),
        expect.objectContaining({ name: 'Ayran', qty: 1 }),
      ]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('browsing text intent shows confirm prompt', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: '2x Döner + Ayran' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_intent_confirm' })]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('zwei kebab mit per-unit modifiers shows inserts and skips customize prompt', async () => {
    const kebabMenu = [{
      id: 'item_kebab',
      name: 'Kebap Sandwich Huhn',
      price: 7.50,
      category: 'mains',
      available: true,
      optionGroups: [{
        ...BEILAGEN_WITH_CHILI,
        required: true,
        options: [
          ...BEILAGEN_WITH_CHILI.options,
          { id: 'sauce', label: 'Sauce' },
        ],
      }],
    }];
    getMenu.mockResolvedValue(kebabMenu);
    getSession.mockResolvedValue({ language: 'de', state: 'browsing', businessId: BIZ, basket: [] });

    const orderText = 'ich hätte gerne zwei Hühner Kebab eine mit allem und andere ohne Schaf und Soße bitte';
    await handleMessage(ROUTING, msg({ text: orderText }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/Scharfe Sauce/i),
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.not.stringMatching(/2x Kebap Sandwich Huhn \(Hühner Kebab\)/),
    }));

    const pendingCall = setSession.mock.calls.find(([, data]) => data.pendingIntentItems?.length);
    expect(pendingCall?.[1].pendingIntentItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ qty: 1, rawIntentName: expect.stringMatching(/mit allem/i) }),
        expect.objectContaining({ qty: 1, rawIntentName: expect.stringMatching(/ohne/i) }),
      ]),
    );

    getSession.mockResolvedValue({
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [],
      pendingIntentItems: pendingCall[1].pendingIntentItems,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_intent_same_opts' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: expect.arrayContaining([
        expect.objectContaining({ name: expect.stringMatching(/Scharfe Sauce/), qty: 1 }),
        expect.objectContaining({ name: expect.stringMatching(/Kebap Sandwich Huhn/), qty: 1 }),
      ]),
    }));
  });

  test('kebap mit scharf stores note when menu has no spicy insert', async () => {
    const kebabMenu = [{
      id: 'item_kebab',
      name: 'Kebap Sandwich Huhn',
      price: 7.50,
      category: 'mains',
      available: true,
      optionGroups: [{
        id: 'inserts',
        label: 'Inserts',
        type: 'multi',
        required: true,
        multiDefault: 'all',
        options: [
          { id: 'tomato', label: 'Tomaten' },
          { id: 'salad', label: 'Salad' },
          { id: 'onion', label: 'Zwiebel' },
          { id: 'sauce', label: 'Sauce' },
        ],
      }],
    }];
    getMenu.mockResolvedValue(kebabMenu);
    getSession.mockResolvedValue({ language: 'de', state: 'browsing', businessId: BIZ, basket: [] });

    const orderText = 'noch ein kebap mit allem und scharf bitte';
    await handleMessage(ROUTING, msg({ text: orderText }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/\(extra scharf\)/i),
    }));

    const pendingCall = setSession.mock.calls.find(([, data]) => data.pendingIntentNote);
    expect(pendingCall?.[1].pendingIntentNote).toBe('extra scharf');

    const storedSession = {
      language: 'de',
      state: 'browsing',
      businessId: BIZ,
      basket: [{ name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 2, price: 7.5 }],
      pendingIntentItems: pendingCall[1].pendingIntentItems,
      pendingIntentNote: 'extra scharf',
      pendingIntentRawText: orderText,
    };
    getSession.mockResolvedValue(storedSession);

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([
        expect.objectContaining({ note: 'extra scharf' }),
      ]),
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/\(extra scharf\)/i),
    }));
  });

  test('btn_intent_confirm merges items into basket', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
    }));
    expect(setSession.mock.calls[0][1]).not.toHaveProperty('pendingIntentItems');
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Ayran'),
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession.mock.invocationCallOrder[0]).toBeLessThan(sendButtonMessage.mock.invocationCallOrder[0]);
  });

  test('proposal edit: remove item re-shows confirm without catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Döner', qty: 2, price: 8.50, menuItemId: 'item_1', optionGroups: [] },
        { name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'remove ayran' }));

    expect(sendListMessage).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.not.stringContaining('Ayran'),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      pendingIntentItems: [expect.objectContaining({ name: 'Döner', qty: 2 })],
    }));
  });

  test('proposal edit: pizza cikar removes pizza (TR suffix remove)', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Kebap Sandwich Huhn', qty: 2, price: 15.00, menuItemId: 'item_1', optionGroups: [] },
        { name: 'Pizza della Casa (33cm)', qty: 1, price: 14.90, menuItemId: 'item_p1', optionGroups: [] },
        { name: 'Coca Cola 0.33L', qty: 1, price: 2.90, menuItemId: 'item_2', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'Pizza cikar' }));

    expect(sendListMessage).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.not.stringContaining('Pizza'),
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Kebap'),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      pendingIntentItems: expect.not.arrayContaining([
        expect.objectContaining({ name: expect.stringMatching(/pizza/i) }),
      ]),
    }));
  });

  test('proposal edit: make it 1 döner changes qty in proposal', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Döner', qty: 2, price: 8.50, menuItemId: 'item_1', optionGroups: [] },
        { name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'make it 1 döner' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      pendingIntentItems: expect.arrayContaining([
        expect.objectContaining({ name: 'Döner', qty: 1 }),
        expect.objectContaining({ name: 'Ayran', qty: 1 }),
      ]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('proposal edit: actually replaces whole proposal', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Döner', qty: 2, price: 8.50, menuItemId: 'item_1', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'actually 1 ayran' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      pendingIntentItems: [expect.objectContaining({ name: 'Ayran', qty: 1 })],
    }));
  });

  test('btn_intent_change sends edit hint without opening catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_change' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('remove'));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('btn_intent_confirm re-hydrates optionGroups from menu when session lost them', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Döner', qty: 1, price: 8.50, menuItemId: 'item_1', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'customizing_intent',
      intentCustomize: expect.objectContaining({
        queue: [expect.objectContaining({ name: 'Döner', qty: 1 })],
      }),
    }));
  });

  test('btn_intent_confirm stores raw intent phrasing on basket line', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        {
          name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [],
          rawIntentName: 'einen ayran bitte',
        },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [expect.objectContaining({
        name: 'Ayran',
        note: 'einen ayran bitte',
      })],
    }), expect.anything());
  });

  test('btn_intent_confirm asks same-or-each when qty > 1', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        {
          name: 'Döner', qty: 2, price: 8.50, menuItemId: 'item_1',
          optionGroups: MENU[0].optionGroups,
        },
        { name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [] },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'customizing_intent',
      basket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
      intentCustomize: expect.objectContaining({
        queue: [expect.objectContaining({ name: 'Döner', qty: 2 })],
        unitMode: null,
      }),
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_intent_same_opts' }),
        expect.objectContaining({ id: 'btn_intent_each_opts' }),
      ]),
    }));
  });

  test('customizing_intent per-unit modifier text skips same-or-each buttons', async () => {
    const inserts = BEILAGEN_WITH_CHILI;
    let stored = {
      language: 'de',
      state: 'customizing_intent',
      businessId: BIZ,
      basket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
      intentCustomize: {
        queue: [{
          name: 'Kebap Sandwich Huhn', qty: 2, price: 7.50, menuItemId: 'item_1',
          optionGroups: [inserts],
        }],
        groupIdx: 0,
        selections: {},
        readyBasket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
        unitMode: null,
        unitIndex: 1,
        unitTotal: 2,
      },
    };
    getSession.mockImplementation(async () => ({ ...stored }));
    setSession.mockImplementation(async (_phone, data) => { stored = { ...data }; });

    await handleMessage(ROUTING, msg({
      text: 'Eine mit allem und andere ohne Zwiebel und Schaf bitte',
    }));

    expect(stored.state).toBe('browsing');
    expect(stored.basket).toEqual([
      { name: 'Ayran', qty: 1, price: 2.00 },
      { name: 'Kebap Sandwich Huhn — Tomato, Salad, Onion, Scharfe Sauce', qty: 1, price: 7.50 },
      { name: 'Kebap Sandwich Huhn — Tomato, Salad', qty: 1, price: 7.50 },
    ]);
  });

  test('customizing_intent same mode completes with multi inserts', async () => {
    let stored = {
      language: 'tr',
      state: 'customizing_intent',
      businessId: BIZ,
      basket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
      intentCustomize: {
        queue: [{
          name: 'Döner', qty: 2, price: 8.50, menuItemId: 'item_1',
          optionGroups: [MENU[0].optionGroups[0], MENU[0].optionGroups[2]],
        }],
        groupIdx: 0,
        selections: {},
        readyBasket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
        unitMode: 'same',
        unitIndex: 1,
        unitTotal: 2,
      },
    };
    getSession.mockImplementation(async () => ({ ...stored }));
    setSession.mockImplementation(async (_phone, data) => { stored = { ...data }; });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'opt_protein_chicken', title: 'Chicken' }));
    expect(stored.intentCustomize.groupIdx).toBe(1);

    await handleMessage(ROUTING, msg({ type: 'text', text: 'tomato, salad' }));

    expect(stored.state).toBe('browsing');
    expect(stored.basket).toEqual([
      { name: 'Ayran', qty: 1, price: 2.00 },
      { name: 'Döner — Chicken, Tomato, Salad', qty: 2, price: 8.50 },
    ]);
  });

  test('customizing_intent each mode adds separate basket lines', async () => {
    let stored = {
      language: 'tr',
      state: 'customizing_intent',
      businessId: BIZ,
      basket: [],
      intentCustomize: {
        queue: [{
          name: 'Döner', qty: 2, price: 8.50, menuItemId: 'item_1',
          optionGroups: [MENU[0].optionGroups[0]],
        }],
        groupIdx: 0,
        selections: {},
        readyBasket: [],
        unitMode: 'each',
        unitIndex: 1,
        unitTotal: 2,
      },
    };
    getSession.mockImplementation(async () => ({ ...stored }));
    setSession.mockImplementation(async (_phone, data) => { stored = { ...data }; });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'opt_protein_chicken', title: 'Chicken' }));
    expect(stored.intentCustomize.unitIndex).toBe(2);

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'opt_protein_lamb', title: 'Lamb' }));

    expect(stored.state).toBe('browsing');
    expect(stored.basket).toEqual([
      { name: 'Döner — Chicken', qty: 1, price: 8.50 },
      { name: 'Döner — Lamb', qty: 1, price: 8.50 },
    ]);
  });

  test('btn_view_basket after btn_intent_confirm reads persisted basket', async () => {
    let stored = {
      language: 'tr', state: 'browsing', businessId: BIZ, basket: [],
      pendingIntentItems: [
        { name: 'Ayran', qty: 1, price: 2.00, menuItemId: 'item_2', optionGroups: [] },
      ],
    };
    getSession.mockImplementation(async () => ({ ...stored }));
    setSession.mockImplementation(async (_phone, data) => {
      stored = { ...data };
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_intent_confirm' }));
    sendButtonMessage.mockClear();

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_view_basket', title: 'Sepeti Gör' }));

    expect(stored.basket).toHaveLength(1);
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Ayran'),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('unmatched intent text shows order entry with no-match hint', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: '2x burger and fries' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('burger'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_search' }),
        expect.objectContaining({ id: 'btn_view_full_menu' }),
      ]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('greeting first message shows order entry prompt', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expectOrderEntryPrompt();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_INFO.name),
    }));
  });

  test('btn_search opens search prompt', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_search' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('looking for'),
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_search_cancel' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ menuSearchActive: true }));
  });

  test('search mode text shows ranked search results', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [], menuSearchActive: true,
    });

    await handleMessage(ROUTING, msg({ text: 'ayran' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'item_item_2', title: 'Ayran' }),
          ]),
        }),
      ]),
    }));
  });

  test('short lookup shows no-match hint when intent and search both fail', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'snack' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('No matches'),
    }));
  });

  test('btn_popular shows configured popular items', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, popularItemIds: ['item_1', 'item_2'] });
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_popular' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'item_item_1' }),
            expect.objectContaining({ id: 'item_item_2' }),
          ]),
        }),
      ]),
    }));
  });
});

// ─── List-reply in browsing state ────────────────────────────────────────────

describe('Browsing state: list_reply item selection', () => {
  test('valid item list_reply transitions to selecting state', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_item_1' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting',
      pendingItem: { name: 'Döner', price: 8.50 },
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'qty_1' }),
        expect.objectContaining({ id: 'qty_2' }),
        expect.objectContaining({ id: 'qty_3' }),
      ]),
    }));
  });

  test('unknown item id shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_unknown_999' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ textMenuIndex: expect.any(Array) }));
  });

  test('item with https:// photoUrl sends image before qty buttons', async () => {
    const photoUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/doner.jpg?alt=media';
    getMenu.mockResolvedValue([{ ...MENU[0], photoUrl }]);
    resolvePhotoUrl.mockReturnValue(photoUrl);
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_item_1' }));

    expect(sendImage).toHaveBeenCalledWith(FROM, { url: photoUrl });
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'qty_1' })]),
    }));
  });

  test('item with gs:// photoUrl converts URL and sends image', async () => {
    const resolvedUrl = 'https://firebasestorage.googleapis.com/v0/b/my-bucket/o/menu%2Fdoner.jpg?alt=media';
    getMenu.mockResolvedValue([{ ...MENU[0], photoUrl: 'gs://my-bucket/menu/doner.jpg' }]);
    resolvePhotoUrl.mockReturnValue(resolvedUrl);
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_item_1' }));

    expect(sendImage).toHaveBeenCalledWith(FROM, { url: resolvedUrl });
  });

  test('item without photoUrl does not send image', async () => {
    // resolvePhotoUrl returns null by default (set in beforeEach)
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_item_1' }));

    expect(sendImage).not.toHaveBeenCalled();
  });

  test('image send failure is non-fatal — qty buttons still shown', async () => {
    const photoUrl = 'https://example.com/img.jpg';
    getMenu.mockResolvedValue([{ ...MENU[0], photoUrl }]);
    resolvePhotoUrl.mockReturnValue(photoUrl);
    sendImage.mockRejectedValue(new Error('network error'));
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_item_1' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'qty_1' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'selecting' }));
  });
});

// ─── Browsing state button actions ───────────────────────────────────────────

describe('Browsing state: button actions', () => {
  test('btn_add_more shows catalog when flow is not list', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_add_more', title: 'Add more' }));

    expect(sendListMessage).toHaveBeenCalled();
  });

  test('btn_add_more shows list menu when flow is list', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', flow: 'list', businessId: BIZ, basket: [] });
    getBusinessInfo.mockResolvedValue({ name: 'Döner Palace', avgPrepTime: 20 }); // no catalogId → list fallback

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_add_more', title: 'Add more' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(sendFlowMessage).not.toHaveBeenCalled();
  });

  test('btn_view_basket with items shows basket text and action buttons', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_view_basket', title: 'View basket' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_remove_item' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });

  test('btn_view_basket with empty basket shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_view_basket', title: 'View basket' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('btn_clear_basket clears basket and shows catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_clear_basket', title: 'Clear' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }));
    expect(sendListMessage).toHaveBeenCalled();
  });

  test('btn_clear_basket drops orderType/deliveryAddress so a re-added basket is not still delivery-gated', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      orderType: 'delivery', // was gated on minimumOrderValue before clearing
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_clear_basket', title: 'Clear' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ orderType: 'delivery' }));
  });

  test('btn_done with items skips notes and transitions to awaiting_name', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_done', title: 'Done' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      pickupTime: expect.any(String),
      prepMins: 20,
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('btn_done with empty basket shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_done', title: 'Done' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ textMenuIndex: expect.any(Array) }));
  });

  test('btn_confirm with items skips notes and transitions to awaiting_name', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Ayran', qty: 2, price: 2.00 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm', title: 'Confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
    }));
  });

  test('btn_cancel_order in browsing (single) clears basket and shows catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
    expect(sendListMessage).toHaveBeenCalled();
  });
});

// ─── Browsing state: basket keyword ──────────────────────────────────────────

describe('Browsing state: basket keyword', () => {
  test('"basket" with items shows basket text', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }, { name: 'Ayran', qty: 2, price: 2.00 }],
    });

    await handleMessage(ROUTING, msg({ text: 'basket' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_remove_item' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });

  test('"sepet" keyword with empty basket shows order entry', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'sepet' }));

    expectOrderEntryPrompt();
  });

  test('"warenkorb" keyword with items shows basket text', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'warenkorb' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
    }));
  });

  test('text menu number "1" shows confirm buttons instead of reopening catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ, basket: [],
      textMenuCategory: 'mains',
      textMenuIndex: [
        { id: 'item_1', name: 'Döner', price: 8.5 },
        { id: 'item_2', name: 'Ayran', price: 2.0 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: '1' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner'),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('category list_reply opens paginated menu and numbered text', async () => {
    const { encodeCategory } = require('../botHelpers');
    const bigMenu = Array.from({ length: 12 }, (_, i) => ({
      id: `item_${i}`,
      name: `Dish ${i}`,
      price: 9,
      category: i < 6 ? 'Pizza' : 'Kebap',
      available: true,
    }));
    getMenu.mockResolvedValue(bigMenu);
    getSession.mockResolvedValue({ language: 'de', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({
      type: 'list_reply',
      id: `cat_${encodeCategory('Pizza')}`,
      title: 'Pizza',
    }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('1.'));
    expect(patchSession).toHaveBeenCalled();
  });
});

describe('Browsing state: basket remove (chat)', () => {
  test('btn_remove_item shows numbered basket with hint and sets remove mode', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Ayran', qty: 1, price: 2.00 },
      ],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_remove_item', title: 'Entfernen' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/1\.\s+1× Döner/),
    }));
    expect(patchSession).toHaveBeenCalledWith(FROM, { basketRemovePending: true }, expect.anything());
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('text "1, 3" in remove mode drops matching lines', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Ayran', qty: 1, price: 2.00 },
        { name: 'Cola', qty: 1, price: 2.90 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: '1, 3' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Ayran', qty: 1, price: 2.00 }],
      basketRemovePending: undefined,
    }), expect.anything());
  });

  test('text "ohne ayran" in remove mode drops matching line', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Ayran', qty: 1, price: 2.00 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'ohne ayran' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    }), expect.anything());
  });

  test('text "cola entfernen" in remove mode does not open intent proposal', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basket: [
        { name: 'Döner', qty: 1, price: 8.50 },
        { name: 'Coca Cola 0.33L', qty: 1, price: 2.90 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'cola entfernen' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      basketRemovePending: undefined,
    }), expect.anything());
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Zum Warenkorb hinzufügen'),
    }));
  });

  test('text "kebap entfernen" with duplicate lines asks which to remove', async () => {
    const dupBasket = [
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.50 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.50 },
    ];
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basket: dupBasket,
    });

    await handleMessage(ROUTING, msg({ text: 'kebap entfernen' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, {
      basketRemoveDisambig: { fragment: 'kebap', indices: [1, 2] },
    }, expect.anything());
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Mehrere Treffer'));
    expect(patchSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }), expect.anything());
  });

  test('disambig reply "1" removes only that line', async () => {
    const dupBasket = [
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.50 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.50 },
    ];
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basketRemoveDisambig: { fragment: 'kebap', indices: [1, 2] },
      basket: dupBasket,
    });

    await handleMessage(ROUTING, msg({ text: '1' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [dupBasket[1]],
      basketRemovePending: undefined,
      basketRemoveDisambig: undefined,
    }), expect.anything());
  });

  test('disambig reply "2" without basketRemovePending removes correct line (conversational basket path)', async () => {
    const dupBasket = [
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.50 },
      { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.50 },
    ];
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      // basketRemovePending is NOT set — only disambig state from sendOpsAmbiguousRemove
      basketRemoveDisambig: { fragment: 'Kebap', indices: [1, 2] },
      basket: dupBasket,
    });

    await handleMessage(ROUTING, msg({ text: '2' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: [dupBasket[0]],
      basketRemoveDisambig: undefined,
    }), expect.anything());
  });

  test('alles löschen in remove mode clears basket', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      orderType: 'delivery',
    });

    await handleMessage(ROUTING, msg({ text: 'alles löschen' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ orderType: 'delivery' }));
  });

  test('alles in remove mode clears basket', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'browsing', businessId: BIZ,
      basketRemovePending: true,
      basket: [
        { name: 'Enes Kebap Special Dürüm Huhn', qty: 1, price: 6.90 },
        { name: 'Pizza Margherita (33cm)', qty: 1, price: 12.90 },
      ],
    });

    await handleMessage(ROUTING, msg({ text: 'alles' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }));
  });
});

describe('Browsing state: conversational basket (Tier 5)', () => {
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

    await handleMessage(ROUTING, msg({ text: '2 döner zum Liefern, Hauptstraße 5, bar' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Hauptstraße 5',
      pendingPaymentMethod: 'cash',
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
});

describe('"start" fully clears the basket instead of letting stale items survive', () => {
  test('browsing state: basket added before "start" must not merge with basket added after', async () => {
    let liveSession = {
      language: 'en', state: 'selecting', businessId: BIZ, basket: [],
      pendingItem: { name: 'Ayran', price: 2.00 },
    };
    getSession.mockImplementation(() => Promise.resolve({ ...liveSession }));
    setSession.mockImplementation(async (_phone, data) => { liveSession = { ...data }; });

    // Add 2x Ayran — lands back in 'browsing' with the item in the basket.
    await handleMessage(ROUTING, msg({ text: '2' }));
    expect(liveSession.basket).toEqual([{ name: 'Ayran', qty: 2, price: 2.00 }]);
    expect(liveSession.state).toBe('browsing');

    // Customer abandons and sends "start" while the old item is still in the basket.
    await handleMessage(ROUTING, msg({ text: 'start' }));
    expect(liveSession.basket).toEqual([]);

    // Re-enter selecting (as if picking Ayran again from the menu) and add 1 more.
    liveSession = { ...liveSession, state: 'selecting', pendingItem: { name: 'Ayran', price: 2.00 } };
    await handleMessage(ROUTING, msg({ text: '1' }));

    // Without the fix, the stale qty:2 line survives "start" and the merge logic in
    // handleSelecting adds the new qty onto it, producing qty:3 instead of qty:1.
    expect(liveSession.basket).toEqual([{ name: 'Ayran', qty: 1, price: 2.00 }]);
  });

  test('checkout state (confirming): existing fresh-start reset path keeps clearing correctly', async () => {
    let liveSession = {
      language: 'en', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Ayran', qty: 2, price: 2.00 }],
    };
    getSession.mockImplementation(() => Promise.resolve({ ...liveSession }));
    setSession.mockImplementation(async (_phone, data) => { liveSession = { ...data }; });

    await handleMessage(ROUTING, msg({ text: 'start' }));
    expect(liveSession.basket).toEqual([]);
    expect(liveSession.state).toBe('browsing');

    liveSession = { ...liveSession, state: 'selecting', pendingItem: { name: 'Ayran', price: 2.00 } };
    await handleMessage(ROUTING, msg({ text: '1' }));

    expect(liveSession.basket).toEqual([{ name: 'Ayran', qty: 1, price: 2.00 }]);
  });
});
