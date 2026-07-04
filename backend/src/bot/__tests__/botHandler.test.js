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

const { handleMessage } = require('../botHandler');
const { getSession, setSession, patchSession } = require('../sessionStore');
const { getMenu, getMenuContext, getBusinessInfo, resolvePhotoUrl } = require('../menuService');
const { createOrder, getLastOrderForCustomer } = require('../orderService');
const { sendText, sendListMessage, sendButtonMessage, sendFlowMessage, sendLocationRequest, sendImage, sendCtaUrlMessage } = require('../../lib/whatsapp');
const { reverseGeocode } = require('../../lib/geocode');
const { customersRef } = require('../../lib/collections');

const BIZ = 'biz_test';
const ROUTING = { businessIds: [BIZ], defaultBusinessId: BIZ, phoneNumberId: 'test_phone_id' };
const FROM = '+43699000001';

const MENU = [
  {
    id: 'item_1',
    name: 'Döner',
    price: 8.50,
    category: 'mains',
    description: 'Chicken',
    available: true,
    optionGroups: [
      {
        id: 'protein',
        label: 'Protein',
        type: 'single',
        required: true,
        options: [
          { id: 'chicken', label: 'Chicken' },
          { id: 'lamb', label: 'Lamb' },
          { id: 'mixed', label: 'Mixed' },
        ],
      },
      {
        id: 'sauce',
        label: 'Sauce',
        type: 'multi',
        required: false,
        options: [
          { id: 'garlic', label: 'Garlic sauce' },
          { id: 'chili', label: 'Chili sauce' },
          { id: 'none', label: 'No sauce' },
        ],
      },
      {
        id: 'inserts',
        label: 'Inserts',
        type: 'multi',
        required: false,
        options: [
          { id: 'tomato', label: 'Tomato' },
          { id: 'salad', label: 'Salad' },
          { id: 'onion', label: 'Onion' },
        ],
      },
    ],
  },
  { id: 'item_2', name: 'Ayran',  price: 2.00, category: 'drinks', description: 'Yogurt drink', available: true },
];

const BEILAGEN_WITH_CHILI = {
  id: 'inserts',
  label: 'Inserts',
  type: 'multi',
  required: false,
  multiDefault: 'all',
  options: [
    { id: 'tomato', label: 'Tomato' },
    { id: 'salad', label: 'Salad' },
    { id: 'onion', label: 'Onion' },
    { id: 'chili', label: 'Scharfe Sauce' },
  ],
};

const BIZ_INFO = { name: 'Döner Palace', avgPrepTime: 20, catalogId: 'cat_123', alertPhone: '+43699123456', address: 'Musterstrasse 1, 1010 Wien', botLanguage: 'de' };

function mockCustomerProfile(data) {
  customersRef.mockReturnValue({ doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ data: () => data }) }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_FLOW_ID = 'flow_test_id';
  getMenu.mockResolvedValue(MENU);
  getMenuContext.mockImplementation(async () => ({
    menu: await getMenu(),
    menuMatch: null,
    menuTokenIndex: null,
  }));
  getBusinessInfo.mockResolvedValue(BIZ_INFO);
  createOrder.mockResolvedValue('order_abc123');
  getLastOrderForCustomer.mockResolvedValue(null);
  sendText.mockResolvedValue();
  sendListMessage.mockResolvedValue('list_msg_id');
  sendButtonMessage.mockResolvedValue();
  sendFlowMessage.mockResolvedValue(null);
  sendLocationRequest.mockResolvedValue();
  sendImage.mockResolvedValue('map_msg_id');
  resolvePhotoUrl.mockImplementation((url) => url ?? null);
  reverseGeocode.mockResolvedValue(null);
  mockCustomerProfile(null); // no saved address by default
});

afterEach(() => {
  delete process.env.WHATSAPP_FLOW_ID;
});

function msg(overrides) {
  return { from: FROM, contactName: 'Test User', type: 'text', text: '', id: null, items: null, ...overrides };
}

function expectOrderEntryPrompt() {
  expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
    buttons: expect.arrayContaining([
      expect.objectContaining({ id: 'btn_search' }),
      expect.objectContaining({ id: 'btn_view_full_menu' }),
    ]),
  }));
}

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

describe('Add note / Back to cart on the final confirmation screen', () => {
  test('btn_add_note asks for the note and moves to awaiting_confirm_note', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_add_note', title: 'Add note 📝' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_confirm_note' }));
  });

  test('typed text in awaiting_confirm_note stores the note and re-shows the confirm screen', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_confirm_note',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'No onions please' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      specialRequests: 'No onions please',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('No onions please'),
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'btn_place_order' }),
          ]),
        }),
      ]),
    }));
  });

  test('btn_back_to_cart shows the basket and moves to browsing without clearing it', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_back_to_cart', title: 'Back to cart 🛒' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_add_more' }),
        expect.objectContaining({ id: 'btn_remove_item' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });
});

describe('Cancel flow', () => {
  test('btn_cancel_order clears state and shows catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendListMessage).toHaveBeenCalled();
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

// ─── Multi-restaurant helpers ──────────────────────────────────────────────────

const ROUTING_MULTI = { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null, phoneNumberId: 'test_phone_id' };
const BIZ_A_INFO = { name: 'Döner Palace', tagline: 'Best döner in town', avgPrepTime: 20, catalogId: 'cat_a', imageUrl: 'https://example.com/biz_a.jpg' };
const BIZ_B_INFO = { name: 'Pizza Roma',   tagline: 'Authentic Italian',  avgPrepTime: 25, catalogId: 'cat_b', imageUrl: 'https://example.com/biz_b.jpg' };

function makeUpdatedAt(msAgo) {
  const d = new Date(Date.now() - msAgo);
  return { toDate: () => d };
}

function multiSession(overrides) {
  return { language: 'en', basket: [], businessId: 'biz_a', ...overrides };
}

// ─── Use case: first-time customer (multi) ────────────────────────────────────

describe('Multi-restaurant: first-time customer', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('first message triggers location request', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
    }));
    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('ORDER+ deep link skips picker and opens restaurant menu', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'de' });

    await handleMessage(ROUTING_MULTI, msg({ text: 'ORDER+biz_b' }));

    expect(sendLocationRequest).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      businessId: 'biz_b',
    }));
  });

  test('ORDER deep link with space skips picker (wa.me prefill)', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'de' });

    await handleMessage(ROUTING_MULTI, msg({ text: 'ORDER biz_b' }));

    expect(sendLocationRequest).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      businessId: 'biz_b',
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

describe('Multi-restaurant: post-order routing', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('language set + no businessId → always requests fresh location (even if lat/lng stored)', async () => {
    getSession.mockResolvedValue({ language: 'en', basket: [], businessId: null, state: 'browsing', lat: 48.1980, lng: 16.3730 });

    await handleMessage(ROUTING_MULTI, msg({ text: 'hi' }));

    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('session set to awaiting_location before API call so failures cannot loop', async () => {
    sendLocationRequest.mockRejectedValueOnce(new Error('API error'));
    getSession.mockResolvedValue({ language: 'en', basket: [], businessId: null, state: 'browsing' });

    await handleMessage(ROUTING_MULTI, msg({ text: 'hi' }));

    // Session must be updated even if sendLocationRequest throws
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
    }));
  });
});

// ─── Use case: awaiting_location state ───────────────────────────────────────

describe('Multi-restaurant: awaiting_location state', () => {
  const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
  const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
    process.env.NGROK_DOMAIN = 'tunnel.ngrok-free.dev';
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.NGROK_DOMAIN;
  });

  test('location message sorts restaurants by distance and shows picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    // Customer is closer to biz_b (48.1980, 16.3730) than biz_a (48.2093, 16.3621)
    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'selecting_restaurant', lat: 48.1980, lng: 16.3730 }));
    expect(sendImage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: expect.stringContaining('tunnel.ngrok-free.dev/api/maps/restaurants-preview'),
      caption: expect.stringContaining('list above'),
    }));
    expect(sendCtaUrlMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      url: expect.stringContaining('/map?clat='),
      buttonLabel: 'Open map',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
    expect(rows[0].title).toMatch(/^1\./);
    expect(rows).toHaveLength(2);
  });

  test('excludes restaurants beyond 20 km from picker and map', async () => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a'
        ? { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 }
        : { ...BIZ_B_INFO, lat: 41.0082, lng: 28.9784 }),
    );
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('restaurant_biz_a');
    const imageUrl = sendImage.mock.calls[0][1].url;
    expect(imageUrl).toContain('48.2093');
    expect(imageUrl).not.toContain('41.0082');
  });

  test('location row description shows distance', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.2093, longitude: 16.3621 }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    // The closest restaurant (biz_a, same coords as customer) should show very small distance
    expect(rows[0].description).toMatch(/📍/);
    expect(rows[0].description).toMatch(/m |km/);
  });

  test('non-location message skips to unsorted picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ text: 'skip' }));

    expect(sendCtaUrlMessage).not.toHaveBeenCalled();
    expect(sendImage).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'selecting_restaurant', lat: null, lng: null }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
    // No distance label when location was skipped — sortByDistance was NOT called so distanceKm is undefined
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    rows.forEach(r => expect(r.description).not.toMatch(/📍/));
  });

  test('location message with null coords falls back to unsorted picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: null, longitude: null }));

    expect(sendListMessage).toHaveBeenCalled();
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    rows.forEach(r => expect(r.description).not.toMatch(/📍/));
  });
});

// ─── Use case: late location share in selecting_restaurant ───────────────────

describe('Multi-restaurant: late location share in selecting_restaurant', () => {
  const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
  const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
    process.env.NGROK_DOMAIN = 'tunnel.ngrok-free.dev';
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.NGROK_DOMAIN;
  });

  test('location message re-shows picker sorted by distance and saves coords to session', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    expect(sendImage).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ lat: 48.1980, lng: 16.3730 }));
    expect(sendListMessage).toHaveBeenCalled();
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
    expect(rows[0].description).toMatch(/📍/);
  });

  test('restaurant selected → lat/lng preserved in browsing session', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null, lat: 48.1980, lng: 16.3730 });

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_a' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_a',
      lat: 48.1980,
      lng: 16.3730,
    }));
  });
});

// ─── Use case: order confirmed → silent receipt, session reset ────────────────

describe('Multi-restaurant: order confirmed sends receipt and resets session', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('sets state to browsing with businessId null and sends receipt text', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
      pickupTime: '14:30',
      specialRequests: '',
    }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: null,
      basket: [],
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Döner Palace'), 'test_phone_id');
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('receipt text includes the order short ID', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
      pickupTime: '14:30',
      specialRequests: '',
    }));
    createOrder.mockResolvedValue('order_abc123');

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'), 'test_phone_id');
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });
});

// ─── Use case: order cancelled → silent text, session reset ──────────────────

describe('Multi-restaurant: order cancelled sends text and resets session', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('sets state to browsing with businessId null and sends cancel text', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
    }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_a',
    }));
    expect(sendText).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
    expect(sendFlowMessage).not.toHaveBeenCalled();
  });
});

// ─── Use case: switch keyword from browsing ───────────────────────────────────

describe('Multi-restaurant: switch keyword from browsing state', () => {
  test('switch keyword with stored location → sorted picker', async () => {
    const BIZ_A_WITH_COORDS = { ...BIZ_A_INFO, lat: 48.2093, lng: 16.3621 };
    const BIZ_B_WITH_COORDS = { ...BIZ_B_INFO, lat: 48.1974, lng: 16.3734 };
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
    getSession.mockResolvedValue(multiSession({ state: 'browsing', lat: 48.1980, lng: 16.3730 }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'switch' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
      lat: 48.1980,
      lng: 16.3730,
    }));
    expect(sendListMessage).toHaveBeenCalled();
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
  });
});

// ─── Use case: TTL safety net for abandoned browsing sessions ─────────────────

describe('Multi-restaurant: TTL safety net (8h idle, browsing, empty basket)', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('9h idle + empty basket → triggers location request', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(9 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
    }));
    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('9h idle + non-empty basket → does NOT show picker (mid-order protection)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      updatedAt: makeUpdatedAt(9 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
  });

  test('2h idle + empty basket → does NOT show picker (within 8h TTL)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(2 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expectOrderEntryPrompt();
  });

  test('9h idle + browsing with no updatedAt → does NOT show picker (no timestamp = no TTL)', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'browsing' })); // no updatedAt

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expectOrderEntryPrompt();
  });
});

// ─── Use case: single-restaurant behavior unchanged ───────────────────────────

describe('Single-restaurant: order complete/cancel behavior unchanged', () => {
  test('order confirmed → browsing state + plain text confirmation (no button message)', async () => {
    getSession.mockResolvedValue({
      language: 'en',
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      pickupTime: '14:30',
      specialRequests: '',
      businessId: BIZ,
    });
    createOrder.mockResolvedValue('order_abc123');

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'), 'test_phone_id');
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('order cancelled → browsing state + catalog (no button message)', async () => {
    getSession.mockResolvedValue({
      language: 'en',
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
      businessId: BIZ,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendListMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });
});

// ─── Language override ────────────────────────────────────────────────────────

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

// ─── selecting_restaurant state ───────────────────────────────────────────────

describe('Multi-restaurant: selecting_restaurant state handling', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('valid restaurant list_reply → browsing state and order entry for selected restaurant', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_b' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_b',
    }));
    expectOrderEntryPrompt();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_B_INFO.name),
    }));
  });

  test('valid restaurant list_reply → reorder prompt when order history exists', async () => {
    getLastOrderForCustomer.mockResolvedValue({
      items: [{ name: 'Döner', qty: 2, price: 8.5 }],
      status: 'delivered',
    });
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_b' }));

    expect(getLastOrderForCustomer).toHaveBeenCalledWith('biz_b', FROM);
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining(BIZ_B_INFO.name),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_reorder_confirm' }),
      ]),
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('invalid restaurant id in list_reply → re-shows picker without state change', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_unknown_999' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({ rows: expect.any(Array) })],
    }));
  });

  test('non-list_reply input while selecting_restaurant → re-shows picker', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'what are my options?' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalled();
  });
});

// ─── selecting state (list-menu qty flow) ────────────────────────────────────

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
});

describe('Checkout state: M2 conversational basket + text gates', () => {
  test('flag on — eine cola dazu during awaiting_name updates basket and re-asks name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: true });
    getMenuContext.mockResolvedValue({
      menu: [
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
      ],
      menuMatch: require('../menuMapper').buildMenuMatchIndex([
        { id: 'd1', name: 'Döner', price: 8.5, available: true },
        { id: 'c1', name: 'Cola', price: 2.5, available: true },
      ]),
      menuTokenIndex: null,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'noch ein cola' }));

    expect(patchSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      basket: expect.arrayContaining([
        expect.objectContaining({ name: 'Döner' }),
        expect.objectContaining({ name: 'Cola' }),
      ]),
    }), expect.anything());
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Name/i));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      customerName: expect.stringMatching(/cola/i),
    }));
  });

  test('flag off — strong order text in awaiting_name is rejected as name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, conversationalBasket: false });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_name', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      prepMins: 20,
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'eine cola dazu' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Bestellung/i));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'confirming' }));
  });

  test('bare digit 1 in confirming does not place order', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'confirming', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Max',
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: '1' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringMatching(/Zeilennummer|line number/i));
  });

  test('karte text in awaiting_payment_method places card order', async () => {
    getBusinessInfo.mockResolvedValue({
      ...BIZ_INFO,
      paymentEnabled: true,
      deliveryEnabled: false,
    });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_payment_method', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Max',
      orderType: 'pickup',
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: 'karte' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({ paymentMethod: 'stripe' }));
  });

  test('abholen text in awaiting_order_type selects pickup', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true });
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_order_type', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ text: 'abholen' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      orderType: 'pickup',
    }));
  });
});

// ─── awaiting_confirm_note fallback ──────────────────────────────────────────

describe('awaiting_confirm_note: invalid input re-prompts', () => {
  test('button_reply re-prompts for the note', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_confirm_note',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_other', title: 'Other' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('empty text re-prompts for the note', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_confirm_note',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30',
    });

    await handleMessage(ROUTING, msg({ text: '' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });
});

// ─── awaiting_name fallback ───────────────────────────────────────────────────

describe('awaiting_name: non-text input shows order summary', () => {
  test('button_reply in awaiting_name shows confirmSummary with basket text', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_name',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'some_btn', title: 'Something' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Döner'));
  });
});

describe('Confirm list: edit name and address before placing order', () => {
  test('confirm_edit_name asks for updated name and moves to awaiting_name', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'confirm_edit_name', title: 'Change name' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('John'));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
  });

  test('confirm_edit_address re-opens delivery address picker', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming', orderType: 'delivery',
      deliveryAddress: 'Old Street 1',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'confirm_edit_address', title: 'Change address' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      header: expect.stringContaining('Delivery address'),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address_choice' }));
  });

  test('confirm_edit_order_type shows pickup/delivery prompt and sets confirmingOrderTypeEdit', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming', orderType: 'pickup',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'confirm_edit_order_type', title: 'Pickup / delivery' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringMatching(/pickup|delivery/i),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_pickup' }),
        expect.objectContaining({ id: 'btn_delivery' }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_order_type',
      confirmingOrderTypeEdit: true,
    }));
  });

  test('switching to pickup from confirm re-shows confirm list without re-asking name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_order_type', confirmingOrderTypeEdit: true,
      orderType: 'delivery', deliveryAddress: 'Old Street 1',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup', title: 'Pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'John',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.not.stringContaining('Old Street 1'),
    }));
  });

  test('switching to delivery from confirm goes to address picker then back to confirm', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_order_type', confirmingOrderTypeEdit: true,
      orderType: 'pickup',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery', title: 'Delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address_choice' }));

    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_delivery_address_choice', confirmingOrderTypeEdit: true,
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_saved', title: 'Last address' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'John',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Naschmarkt'),
    }));
  });
});

// ─── confirming state: ambiguous input ───────────────────────────────────────

describe('Confirming state: ambiguous input', () => {
  test('unrecognized text re-shows confirm list and does not create order', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ text: 'maybe later' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('John'),
    }));
  });

  test('greeting in confirming state restarts ordering instead of yesNoOnly', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue({
      language: 'tr', state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('YES'));
    expectOrderEntryPrompt();
  });

  test('text "yes" confirms order (text-path CONFIRM keyword)', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John', pickupTime: '14:30', specialRequests: '',
    });

    await handleMessage(ROUTING, msg({ text: 'yes' }));

    expect(createOrder).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
  });

  test('text "no" cancels order (text-path CANCEL keyword)', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ text: 'no' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
    expect(sendListMessage).toHaveBeenCalled();
  });
});

// ─── Newly added restaurant appears in picker ─────────────────────────────────

describe('Multi-restaurant: newly added restaurant appears in picker', () => {
  const BIZ_C_INFO = { name: 'Sushi Garden', tagline: 'Fresh sushi', avgPrepTime: 30, catalogId: 'cat_c' };
  const ROUTING_3 = { businessIds: ['biz_a', 'biz_b', 'biz_c'], defaultBusinessId: null };

  beforeEach(() => {
    getBusinessInfo.mockImplementation(id => {
      if (id === 'biz_a') return Promise.resolve(BIZ_A_INFO);
      if (id === 'biz_b') return Promise.resolve(BIZ_B_INFO);
      return Promise.resolve(BIZ_C_INFO);
    });
  });

  test('picker lists all 3 restaurants including newly added one', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ text: 'skip' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
          expect.objectContaining({ id: 'restaurant_biz_c' }),
        ]),
      })],
    }));
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows).toHaveLength(3);
  });

  test('newly added restaurant (biz_c) is selectable and shows order entry', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ type: 'list_reply', id: 'restaurant_biz_c' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_c',
    }));
    expectOrderEntryPrompt();
  });

  test('picker row title shows newly added restaurant name', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ text: 'skip' }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    const bizCRow = rows.find(r => r.id === 'restaurant_biz_c');
    expect(bizCRow).toBeDefined();
    expect(bizCRow.title).toBe('Sushi Garden');
  });
});

// ─── Removed restaurant absent from picker ───────────────────────────────────

describe('Multi-restaurant: removed restaurant absent from picker', () => {
  const ROUTING_AFTER_REMOVAL = { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null };

  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO),
    );
  });

  test('picker shows only 2 restaurants after biz_c was removed', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_AFTER_REMOVAL, msg({ text: 'skip' }));

    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id)).not.toContain('restaurant_biz_c');
  });

  test('removed restaurant id in list_reply is rejected and re-shows picker', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_AFTER_REMOVAL, msg({ type: 'list_reply', id: 'restaurant_biz_c' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
  });
});

// ---------------------------------------------------------------------------
// Delivery flow
// ---------------------------------------------------------------------------

const BASE_SESSION = {
  language: 'en',
  basket: [{ name: 'Döner', qty: 2, price: 8.5 }],
  pickupTime: '14:30',
  prepMins: 20,
  specialRequests: '',
};

describe('Delivery flow: confirming basket → awaiting_order_type (notes skipped)', () => {
  test('delivery-enabled business shows Pickup/Delivery buttons straight from the basket', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_order_type' }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_pickup' }),
        expect.objectContaining({ id: 'btn_delivery' }),
      ]),
    }));
  });

  test('pickup-only business skips order type prompt and goes straight to awaiting_name', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: false });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_delivery' })]),
    }));
  });
});

describe('Delivery flow: awaiting_order_type', () => {
  test('btn_pickup transitions to awaiting_name with orderType pickup', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      orderType: 'pickup',
    }));
  });

  test('btn_delivery with no known addresses goes straight to awaiting_delivery_address', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
      orderType: 'delivery',
    }));
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('btn_delivery with session lat/lng shows address picker', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type', lat: 48.1975, lng: 16.3599 });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_choice',
      orderType: 'delivery',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'delivery_loc_start', description: 'Mariahilfer Str. 10, 1060 Wien' }),
            expect.objectContaining({ id: 'delivery_addr_new' }),
            expect.objectContaining({ id: 'delivery_addr_share' }),
          ]),
        }),
      ]),
    }));
  });

  test('btn_delivery with saved profile address shows address picker', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_choice',
      orderType: 'delivery',
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'delivery_addr_saved', description: 'Naschmarkt 5, 1040 Wien' }),
          ]),
        }),
      ]),
    }));
  });

  test('unrecognised input re-shows the Pickup/Delivery buttons', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ text: 'what?' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_pickup' }),
        expect.objectContaining({ id: 'btn_delivery' }),
      ]),
    }));
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('Delivery minimum order value gate', () => {
  test('btn_delivery below minimumOrderValue shows basket warning, skips the address step', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 20 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' }); // basket subtotal = 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(sendListMessage).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('20.00'),
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      orderType: 'delivery',
    }));
  });

  test('btn_delivery at/above minimumOrderValue proceeds to address step as usual', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 10 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' }); // basket subtotal = 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_delivery' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
      orderType: 'delivery',
    }));
  });

  test('btn_confirm while still below minimum re-shows the gate', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 50 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing', orderType: 'delivery' }); // subtotal 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
  });

  test('btn_done resumes straight into the delivery address step (not pickup/delivery, no notes ask) once minimum is met', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 10 });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'browsing',
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 3, price: 8.5 }], // 25.5, meets 10
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_done' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address' }));
    expect(sendButtonMessage).not.toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_delivery' })]),
    }));
  });

  test('qty selector shows the gate (no Confirm) when adding an item still leaves the basket below minimum', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, minimumOrderValue: 50 });
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      pendingItem: { name: 'Ayran', price: 2.00 },
      orderType: 'delivery',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', orderType: 'delivery' }));
  });

  test('qty selector shows Confirm once the added item brings the basket up to the minimum', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, minimumOrderValue: 10 });
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      pendingItem: { name: 'Ayran', price: 2.00 },
      orderType: 'delivery',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
  });

  test('btn_view_basket while gated hides Confirm until minimum is met', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, minimumOrderValue: 50 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing', orderType: 'delivery' }); // subtotal 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_view_basket' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.not.arrayContaining([expect.objectContaining({ id: 'btn_confirm' })]),
    }));
    expect(setSession).not.toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_delivery_address' }));
  });

  test('pickup orders are never gated by minimumOrderValue', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, minimumOrderValue: 100 });
    mockCustomerProfile({ name: 'Mehmet' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' }); // subtotal 17

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'confirming' }));
  });

  test('adding an item via qty selector preserves orderType and deliveryAddress (no checkout restart)', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'selecting', businessId: BIZ, basket: [],
      pendingItem: { name: 'Ayran', price: 2.00 },
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'qty_1', title: '1' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });
});

describe('Delivery flow: awaiting_delivery_address', () => {
  test('location pin with successful geocode saves human-readable address and moves to awaiting_name', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ type: 'location', latitude: 48.1975, longitude: 16.3599 }));

    expect(reverseGeocode).toHaveBeenCalledWith(48.1975, 16.3599);
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
    }));
  });

  test('location pin with failed geocode falls back to coordinate string', async () => {
    reverseGeocode.mockResolvedValue(null);
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ type: 'location', latitude: 48.1975, longitude: 16.3599 }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: '48.1975, 16.3599',
    }));
  });

  test('text message is accepted as delivery address and moves to awaiting_name', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: 'Naschmarkt 5, 1040 Wien' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });

  test('empty text re-prompts for address without changing state', async () => {
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: '' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('Delivery flow: confirming → createOrder', () => {
  test('delivery order passes orderType, deliveryAddress, deliveryFee and null pickupTime to createOrder', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryFee: 2.5 });
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      deliveryFee: 2.5,
      pickupTime: null,
    }));
  });

  test('pickup order passes orderType pickup, null deliveryAddress, zero deliveryFee', async () => {
    getSession.mockResolvedValue({
      ...BASE_SESSION,
      state: 'confirming',
      orderType: 'pickup',
      customerName: 'Ahmet',
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_place_order' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      orderType: 'pickup',
      deliveryAddress: null,
      deliveryFee: 0,
      pickupTime: '14:30',
    }));
  });
});

const ADDR_CHOICE_SESSION = {
  ...BASE_SESSION,
  state: 'awaiting_delivery_address_choice',
  orderType: 'delivery',
  lat: 48.1975,
  lng: 16.3599,
};

describe('Delivery flow: awaiting_delivery_address_choice', () => {
  test('delivery_loc_start geocodes session lat/lng and transitions to awaiting_name', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_loc_start' }));

    expect(reverseGeocode).toHaveBeenCalledWith(48.1975, 16.3599);
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
    }));
  });

  test('delivery_loc_start falls back to coordinate string when geocode fails', async () => {
    reverseGeocode.mockResolvedValue(null);
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_loc_start' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: '48.1975, 16.3599',
    }));
  });

  test('delivery_addr_saved fetches profile address and transitions to awaiting_name', async () => {
    mockCustomerProfile({ lastDeliveryAddress: 'Naschmarkt 5, 1040 Wien' });
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_saved' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });

  test('delivery_addr_new asks for typed address and transitions to awaiting_delivery_address', async () => {
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_new' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
    }));
  });

  test('delivery_addr_share sends location request and transitions to awaiting_delivery_address', async () => {
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ type: 'list_reply', id: 'delivery_addr_share' }));

    expect(sendLocationRequest).toHaveBeenCalledWith(FROM, expect.any(String));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address',
    }));
  });

  test('unrecognised input re-shows the address picker', async () => {
    reverseGeocode.mockResolvedValue('Mariahilfer Str. 10, 1060 Wien');
    getSession.mockResolvedValue(ADDR_CHOICE_SESSION);

    await handleMessage(ROUTING, msg({ text: 'huh?' }));

    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([expect.objectContaining({ id: 'delivery_loc_start' })]),
        }),
      ]),
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_delivery_address_choice',
    }));
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

describe('Known-name skip: awaiting_name bypassed for returning customers', () => {
  test('returning customer (name in profile) skips awaiting_name and jumps to confirming', async () => {
    mockCustomerProfile({ name: 'Ahmet' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Ahmet',
    }));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('name'));
  });

  test('new customer (no profile name) still asks for name', async () => {
    mockCustomerProfile(null);
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('anonymous fallback name ("WhatsApp Customer") is treated as no name — still asks', async () => {
    mockCustomerProfile({ name: 'WhatsApp Customer' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
  });

  test('returning customer choosing pickup skips awaiting_name', async () => {
    mockCustomerProfile({ name: 'Bilal' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_order_type' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_pickup' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Bilal',
    }));
  });

  test('returning customer providing typed delivery address skips awaiting_name', async () => {
    mockCustomerProfile({ name: 'Bilal' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_delivery_address', orderType: 'delivery' });

    await handleMessage(ROUTING, msg({ text: 'Naschmarkt 5, 1040 Wien' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Bilal',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
    }));
  });
});

// ─── Fresh start clears stale basket (P1-W4 regression) ──────────────────────

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
