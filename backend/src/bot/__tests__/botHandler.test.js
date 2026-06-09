jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../sessionStore');
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');

const { handleMessage } = require('../botHandler');
const { getSession, setSession } = require('../sessionStore');
const { getMenu, getBusinessInfo } = require('../menuService');
const { createOrder } = require('../orderService');
const { sendText, sendListMessage, sendButtonMessage, sendCatalogMessage } = require('../../lib/whatsapp');

const BIZ = 'biz_test';
const ROUTING = { businessIds: [BIZ], defaultBusinessId: BIZ };
const FROM = '+43699000001';

const MENU = [
  { id: 'item_1', name: 'Döner',  price: 8.50, category: 'mains',  description: 'Chicken', available: true },
  { id: 'item_2', name: 'Ayran',  price: 2.00, category: 'drinks', description: 'Yogurt drink', available: true },
];

const BIZ_INFO = { name: 'Döner Palace', avgPrepTime: 20, catalogId: 'cat_123' };

beforeEach(() => {
  jest.clearAllMocks();
  getMenu.mockResolvedValue(MENU);
  getBusinessInfo.mockResolvedValue(BIZ_INFO);
  createOrder.mockResolvedValue('order_abc123');
  sendText.mockResolvedValue();
  sendListMessage.mockResolvedValue();
  sendButtonMessage.mockResolvedValue();
  sendCatalogMessage.mockResolvedValue();
});

function msg(overrides) {
  return { from: FROM, contactName: 'Test User', type: 'text', text: '', id: null, items: null, ...overrides };
}

describe('Full flow: language detection → catalog → cart → special requests → name → confirm → order', () => {

  test('Step 1: first message triggers language detection and shows catalog', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expect(sendCatalogMessage).toHaveBeenCalledWith(FROM, 'cat_123', expect.stringContaining('Döner Palace'), 'item_1');
  });

  test('Step 2: cart_submitted moves to awaiting_special_requests and shows prompt', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing' });

    await handleMessage(ROUTING, msg({
      type: 'cart_submitted',
      items: [{ productId: 'item_1', qty: 2, price: 8.50, currency: 'EUR' }],
    }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_special_requests',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: expect.any(String),
      prepMins: 20,
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_skip_requests' }),
      ]),
    }));
  });

  test('Step 3a: text special request moves to awaiting_name', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_special_requests',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ text: 'No onions please' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      specialRequests: 'No onions please',
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('Step 3b: btn_skip_requests moves to awaiting_name with empty notes', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_special_requests',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_skip_requests', title: 'Atla' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      specialRequests: '',
    }));
  });

  test('Step 4: user sends name → shows final confirm button message', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_name',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
      specialRequests: '',
    });

    await handleMessage(ROUTING, msg({ text: 'Ahmet' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Ahmet',
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Ahmet'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_place_order' }),
        expect.objectContaining({ id: 'btn_cancel_order' }),
      ]),
    }));
  });

  test('Step 5: btn_place_order creates order with notes and sends confirmation', async () => {
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
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'));
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
    expect(sendCatalogMessage).toHaveBeenCalled();
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
});

describe('Edge cases', () => {
  test('empty cart_submitted shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'cart_submitted', items: [] }));

    expect(sendCatalogMessage).toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('no catalogId falls back to list menu', async () => {
    getBusinessInfo.mockResolvedValue({ name: 'Test', avgPrepTime: 30 }); // no catalogId
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
    expect(sendCatalogMessage).not.toHaveBeenCalled();
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

  test('default text in browsing state shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ text: 'something random' }));

    expect(sendCatalogMessage).toHaveBeenCalled();
  });

  test('catalog failure falls back to list menu', async () => {
    sendCatalogMessage.mockRejectedValue(new Error('API error'));
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
  });
});

// ─── Multi-restaurant helpers ──────────────────────────────────────────────────

const ROUTING_MULTI = { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null };
const BIZ_A_INFO = { name: 'Döner Palace', tagline: 'Best döner in town', avgPrepTime: 20, catalogId: 'cat_a' };
const BIZ_B_INFO = { name: 'Pizza Roma',   tagline: 'Authentic Italian',  avgPrepTime: 25, catalogId: 'cat_b' };

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

  test('shows restaurant picker with all businesses', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a', title: 'Döner Palace' }),
          expect.objectContaining({ id: 'restaurant_biz_b', title: 'Pizza Roma' }),
        ]),
      })],
    }));
  });
});

// ─── Use case: order confirmed → awaiting_restaurant_choice ──────────────────

describe('Multi-restaurant: order confirmed transitions to awaiting_restaurant_choice', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('sets state to awaiting_restaurant_choice and sends choice buttons', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
      pickupTime: '14:30',
      specialRequests: '',
    }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_restaurant_choice',
      businessId: 'biz_a',
      basket: [],
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner Palace'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_order_again' }),
        expect.objectContaining({ id: 'btn_choose_restaurant' }),
      ]),
    }));
  });

  test('order confirmation body includes the order short ID', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
      pickupTime: '14:30',
      specialRequests: '',
    }));
    createOrder.mockResolvedValue('order_abc123');

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Confirm ✅' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('ABC123'),
    }));
    expect(sendText).not.toHaveBeenCalled();
  });
});

// ─── Use case: order cancelled → awaiting_restaurant_choice ──────────────────

describe('Multi-restaurant: order cancelled transitions to awaiting_restaurant_choice', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('sets state to awaiting_restaurant_choice and sends choice buttons', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Alice',
    }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_restaurant_choice',
      businessId: 'biz_a',
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_order_again' }),
        expect.objectContaining({ id: 'btn_choose_restaurant' }),
      ]),
    }));
    expect(sendCatalogMessage).not.toHaveBeenCalled();
  });
});

// ─── Use case: awaiting_restaurant_choice interactions ───────────────────────

describe('Multi-restaurant: awaiting_restaurant_choice state interactions', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('btn_order_again → browsing state and shows catalog at same restaurant', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'awaiting_restaurant_choice' }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_order_again', title: 'Order here again' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing' }));
    expect(sendCatalogMessage).toHaveBeenCalledWith(FROM, 'cat_a', expect.any(String), expect.any(String));
  });

  test('btn_choose_restaurant → selecting_restaurant state and shows full picker', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'awaiting_restaurant_choice' }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'button_reply', id: 'btn_choose_restaurant', title: 'Choose restaurant' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
    }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_a' }),
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
  });

  test('random text re-shows the choice prompt without changing state', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'awaiting_restaurant_choice' }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'hello' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      body: expect.stringContaining('Döner Palace'),
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_order_again' }),
        expect.objectContaining({ id: 'btn_choose_restaurant' }),
      ]),
    }));
  });

  test('returning customer (session days old) still sees the choice prompt', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'awaiting_restaurant_choice',
      updatedAt: makeUpdatedAt(48 * 60 * 60 * 1000), // 48 hours ago
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'hi' }));

    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_order_again' }),
        expect.objectContaining({ id: 'btn_choose_restaurant' }),
      ]),
    }));
    expect(sendCatalogMessage).not.toHaveBeenCalled();
  });

  test('switch keyword from awaiting_restaurant_choice shows picker (keyword shortcut still works)', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'awaiting_restaurant_choice' }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'switch' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
    }));
    expect(sendListMessage).toHaveBeenCalled();
  });
});

// ─── Use case: TTL safety net for abandoned browsing sessions ─────────────────

describe('Multi-restaurant: TTL safety net (8h idle, browsing, empty basket)', () => {
  beforeEach(() => {
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_INFO : BIZ_B_INFO)
    );
  });

  test('9h idle + empty basket → shows restaurant picker', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(9 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting_restaurant',
      businessId: null,
    }));
    expect(sendListMessage).toHaveBeenCalled();
  });

  test('9h idle + non-empty basket → does NOT show picker (mid-order protection)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      updatedAt: makeUpdatedAt(9 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendCatalogMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('2h idle + empty basket → does NOT show picker (within 8h TTL)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(2 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendCatalogMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('9h idle + browsing with no updatedAt → does NOT show picker (no timestamp = no TTL)', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'browsing' })); // no updatedAt

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendCatalogMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
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
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'));
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
    expect(sendCatalogMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });
});
