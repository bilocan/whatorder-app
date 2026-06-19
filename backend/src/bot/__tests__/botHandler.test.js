jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../sessionStore');
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');
jest.mock('../../lib/geocode');
jest.mock('../../lib/collections', () => ({ customersRef: jest.fn() }));

const { handleMessage } = require('../botHandler');
const { getSession, setSession } = require('../sessionStore');
const { getMenu, getBusinessInfo, resolvePhotoUrl } = require('../menuService');
const { createOrder } = require('../orderService');
const { sendText, sendListMessage, sendButtonMessage, sendFlowMessage, sendLocationRequest, sendImage } = require('../../lib/whatsapp');
const { reverseGeocode } = require('../../lib/geocode');
const { customersRef } = require('../../lib/collections');

const BIZ = 'biz_test';
const ROUTING = { businessIds: [BIZ], defaultBusinessId: BIZ };
const FROM = '+43699000001';

const MENU = [
  { id: 'item_1', name: 'Döner',  price: 8.50, category: 'mains',  description: 'Chicken', available: true },
  { id: 'item_2', name: 'Ayran',  price: 2.00, category: 'drinks', description: 'Yogurt drink', available: true },
];

const BIZ_INFO = { name: 'Döner Palace', avgPrepTime: 20, catalogId: 'cat_123', alertPhone: '+43699123456', address: 'Musterstrasse 1, 1010 Wien', botLanguage: 'de' };

function mockCustomerProfile(data) {
  customersRef.mockReturnValue({ doc: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ data: () => data }) }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_FLOW_ID = 'flow_test_id';
  getMenu.mockResolvedValue(MENU);
  getBusinessInfo.mockResolvedValue(BIZ_INFO);
  createOrder.mockResolvedValue('order_abc123');
  sendText.mockResolvedValue();
  sendListMessage.mockResolvedValue('list_msg_id');
  sendButtonMessage.mockResolvedValue();
  sendFlowMessage.mockResolvedValue(null);
  sendLocationRequest.mockResolvedValue();
  sendImage.mockResolvedValue();
  resolvePhotoUrl.mockReturnValue(null);
  reverseGeocode.mockResolvedValue(null);
  mockCustomerProfile(null); // no saved address by default
});

afterEach(() => {
  delete process.env.WHATSAPP_FLOW_ID;
});

function msg(overrides) {
  return { from: FROM, contactName: 'Test User', type: 'text', text: '', id: null, items: null, ...overrides };
}

describe('Full flow: language detection → catalog → cart → special requests → name → confirm → order', () => {

  test('Step 1: first message triggers language detection and shows catalog', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({ flowId: 'flow_test_id', flowToken: `${FROM}|${BIZ}` }));
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
    expect(sendFlowMessage).toHaveBeenCalled();
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

    // 'bir' and 'döner' are TR (score TR:2), 'ja' is DE (score DE:1) — TR wins = no change
    await handleMessage(ROUTING, msg({ text: 'bir döner ja' }));

    // No setSession call: re-detect didn't flip (same language), browsing default has no state change
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('Edge cases', () => {
  test('empty cart_submitted shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ type: 'cart_submitted', items: [] }));

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('no WHATSAPP_FLOW_ID falls back to list menu', async () => {
    delete process.env.WHATSAPP_FLOW_ID;
    getSession.mockResolvedValue({});

    await handleMessage(ROUTING, msg({ text: 'Hello' }));

    expect(sendListMessage).toHaveBeenCalled();
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

  test('default text in browsing state shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(ROUTING, msg({ text: 'something random' }));

    expect(sendFlowMessage).toHaveBeenCalled();
  });

  test('flow failure falls back to list menu', async () => {
    sendFlowMessage.mockRejectedValue(new Error('API error'));
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
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
  });

  test('location message sorts restaurants by distance and shows picker', async () => {
    getSession.mockResolvedValue({ state: 'awaiting_location', language: 'en', basket: [], businessId: null });

    // Customer is closer to biz_b (48.1980, 16.3730) than biz_a (48.2093, 16.3621)
    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'selecting_restaurant', lat: 48.1980, lng: 16.3730 }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: 'restaurant_biz_b' }),
        ]),
      })],
    }));
    // First row should be biz_b (closer)
    const rows = sendListMessage.mock.calls[0][1].sections[0].rows;
    expect(rows[0].id).toBe('restaurant_biz_b');
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
    getBusinessInfo.mockImplementation(id =>
      Promise.resolve(id === 'biz_a' ? BIZ_A_WITH_COORDS : BIZ_B_WITH_COORDS)
    );
  });

  test('location message re-shows picker sorted by distance and saves coords to session', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_MULTI, msg({ type: 'location', latitude: 48.1980, longitude: 16.3730 }));

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
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Döner Palace'));
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

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'));
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

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('2h idle + empty basket → does NOT show picker (within 8h TTL)', async () => {
    getSession.mockResolvedValue(multiSession({
      state: 'browsing',
      updatedAt: makeUpdatedAt(2 * 60 * 60 * 1000),
    }));

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendListMessage).not.toHaveBeenCalled();
  });

  test('9h idle + browsing with no updatedAt → does NOT show picker (no timestamp = no TTL)', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'browsing' })); // no updatedAt

    await handleMessage(ROUTING_MULTI, msg({ text: 'Hello' }));

    expect(sendFlowMessage).toHaveBeenCalled();
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
    expect(sendFlowMessage).toHaveBeenCalled();
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
  test('shows menuEmpty text when no items in menu', async () => {
    getBusinessInfo.mockResolvedValue({ name: 'Empty Bistro', avgPrepTime: 20 }); // no catalogId → falls to sendMenu
    getMenu.mockResolvedValue([]);
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'anything' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('No items'));
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

  test('valid restaurant list_reply → browsing state and catalog for selected restaurant', async () => {
    getSession.mockResolvedValue(multiSession({ state: 'selecting_restaurant', businessId: null }));

    await handleMessage(ROUTING_MULTI, msg({ type: 'list_reply', id: 'restaurant_biz_b' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_b',
    }));
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({ flowId: 'flow_test_id', flowToken: `${FROM}|biz_b` }));
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
        expect.objectContaining({ id: 'btn_done' }),
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

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
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

    expect(sendFlowMessage).toHaveBeenCalled();
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
        expect.objectContaining({ id: 'btn_clear_basket' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });

  test('btn_view_basket with empty basket shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_view_basket', title: 'View basket' }));

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
  });

  test('btn_clear_basket clears basket and shows catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_clear_basket', title: 'Clear' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }));
    expect(sendFlowMessage).toHaveBeenCalled();
  });

  test('btn_done with items transitions to awaiting_special_requests', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_done', title: 'Done' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_special_requests',
      pickupTime: expect.any(String),
      prepMins: 20,
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: [expect.objectContaining({ id: 'btn_skip_requests' })],
    }));
  });

  test('btn_done with empty basket shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_done', title: 'Done' }));

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('btn_confirm with items transitions to awaiting_special_requests', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Ayran', qty: 2, price: 2.00 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_confirm', title: 'Confirm' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_special_requests',
    }));
  });

  test('btn_cancel_order in browsing (single) clears basket and shows catalog', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'browsing', businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
    expect(sendFlowMessage).toHaveBeenCalled();
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
        expect.objectContaining({ id: 'btn_clear_basket' }),
        expect.objectContaining({ id: 'btn_confirm' }),
      ]),
    }));
  });

  test('"sepet" keyword with empty basket shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', businessId: BIZ, basket: [] });

    await handleMessage(ROUTING, msg({ text: 'sepet' }));

    expect(sendFlowMessage).toHaveBeenCalled();
    expect(sendButtonMessage).not.toHaveBeenCalled();
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
});

// ─── awaiting_special_requests fallback ──────────────────────────────────────

describe('awaiting_special_requests: invalid input re-prompts', () => {
  test('button_reply other than btn_skip_requests re-prompts for special requests', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'awaiting_special_requests',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_other', title: 'Other' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_skip_requests' })]),
    }));
  });

  test('empty text re-prompts for special requests', async () => {
    getSession.mockResolvedValue({
      language: 'de', state: 'awaiting_special_requests',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(ROUTING, msg({ text: '' }));

    expect(setSession).not.toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: 'btn_skip_requests' })]),
    }));
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

// ─── confirming state: ambiguous input ───────────────────────────────────────

describe('Confirming state: ambiguous input', () => {
  test('unrecognized text sends yesNoOnly and does not create order', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(ROUTING, msg({ text: 'maybe later' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('YES or NO'));
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
    expect(sendFlowMessage).toHaveBeenCalled();
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

  test('newly added restaurant (biz_c) is selectable and opens its catalog', async () => {
    getSession.mockResolvedValue({ state: 'selecting_restaurant', language: 'en', basket: [], businessId: null });

    await handleMessage(ROUTING_3, msg({ type: 'list_reply', id: 'restaurant_biz_c' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      businessId: 'biz_c',
    }));
    expect(sendFlowMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({ flowId: 'flow_test_id', flowToken: `${FROM}|biz_c` }));
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

describe('Delivery flow: awaiting_special_requests → awaiting_order_type', () => {
  test('delivery-enabled business shows Pickup/Delivery buttons after special requests', async () => {
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryEnabled: true, deliveryFee: 2.5 });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_special_requests' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_skip_requests' }));

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
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_special_requests' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_skip_requests' }));

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

describe('Known-name skip: awaiting_name bypassed for returning customers', () => {
  test('returning customer (name in profile) skips awaiting_name and jumps to confirming', async () => {
    mockCustomerProfile({ name: 'Ahmet' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_special_requests' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_skip_requests' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'confirming',
      customerName: 'Ahmet',
    }));
    expect(sendText).not.toHaveBeenCalledWith(FROM, expect.stringContaining('name'));
  });

  test('new customer (no profile name) still asks for name', async () => {
    mockCustomerProfile(null);
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_special_requests' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_skip_requests' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'awaiting_name' }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('anonymous fallback name ("WhatsApp Customer") is treated as no name — still asks', async () => {
    mockCustomerProfile({ name: 'WhatsApp Customer' });
    getSession.mockResolvedValue({ ...BASE_SESSION, state: 'awaiting_special_requests' });

    await handleMessage(ROUTING, msg({ type: 'button_reply', id: 'btn_skip_requests' }));

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
