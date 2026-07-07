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

  test('item selection shows qty buttons without sending product image', async () => {
    const photoUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/doner.jpg?alt=media';
    getMenu.mockResolvedValue([{ ...MENU[0], photoUrl }]);
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'item_item_1' }));

    expect(sendImage).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'qty_1' })]),
    }));
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
