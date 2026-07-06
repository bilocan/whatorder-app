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
