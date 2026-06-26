/**
 * E2E: Full order workflow
 *
 * Real modules: botHandler, orderService, templates, languageDetector
 * Mocked I/O:  Firestore (collections), WhatsApp API (whatsapp), session store,
 *              menu/business info, geocoding, schedule open/closed, distance sort
 *
 * Tests the complete chain:
 *   place order → owner notified → status transition → customer notified
 */

jest.mock('../lib/firebase', () => ({
  db: {},
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn().mockReturnValue('__ts__'),
        increment: jest.fn((n) => ({ __increment: n })),
        arrayUnion: jest.fn((v) => ({ __arrayUnion: v })),
      },
    },
  },
}));
jest.mock('../lib/whatsapp');
jest.mock('../lib/whatsappRouting', () => ({
  resolvePhoneNumberIdForOrder: jest.fn().mockImplementation(async (order) => order?.whatsappPhoneNumberId ?? 'PH_E2E'),
}));
jest.mock('../lib/collections');
jest.mock('../bot/sessionStore');
jest.mock('../bot/menuService');
jest.mock('../lib/geocode');
jest.mock('../lib/schedule');
jest.mock('../lib/distance');

// Real business logic
const { handleMessage } = require('../bot/botHandler');
const { markReady, approveOrder, startPreparation } = require('../bot/orderService');

const { sendText, sendButtonMessage, sendFlowMessage, sendListMessage,
  sendLocationRequest, deleteMessage } = require('../lib/whatsapp');
const { getSession, setSession } = require('../bot/sessionStore');
const { getMenu, getBusinessInfo } = require('../bot/menuService');
const { ordersRef, businessRef, customersRef } = require('../lib/collections');
const { isOpenNow, isOrderingOpen, getTodayOrderWindow } = require('../lib/schedule');
const { sortByDistance } = require('../lib/distance');

// ── Constants ─────────────────────────────────────────────────────────────────

const BIZ           = 'biz_e2e';
const ROUTING       = { businessIds: [BIZ], defaultBusinessId: BIZ, phoneNumberId: 'PH_E2E' };
const CUSTOMER_PHONE = '+43699000001';
const OWNER_PHONE    = '+43699999999';
const ORDER_ID       = 'order_E2ETEST';

const MENU = [
  { id: 'item_1', name: 'Döner', price: 8.50, category: 'mains', available: true },
  { id: 'item_2', name: 'Ayran', price: 2.00, category: 'drinks', available: true },
];

const BIZ_INFO = {
  name: 'Döner Palace',
  avgPrepTime: 20,
  alertPhone: OWNER_PHONE,
  address: 'Musterstrasse 1, 1010 Wien',
  catalogId: 'cat_123',
  botLanguage: 'de',
  schedule: null,
  timezone: 'Europe/Vienna',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrdersRefForCreate() {
  const mockSet = jest.fn().mockResolvedValue(undefined);
  const newDocRef = { id: ORDER_ID, set: mockSet };
  ordersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(newDocRef) });
  return mockSet;
}

function makeOrdersRefForTransition(status) {
  const mockUpdate = jest.fn().mockResolvedValue(undefined);
  const existingDocRef = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ status, customerPhone: CUSTOMER_PHONE, language: 'tr', whatsappPhoneNumberId: 'PH_E2E' }),
    }),
    update: mockUpdate,
  };
  ordersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(existingDocRef) });
  return mockUpdate;
}

function makeBusinessRef() {
  businessRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ alertPhone: OWNER_PHONE, name: BIZ_INFO.name }),
    }),
  });
}

function makeCustomersRef() {
  const mockSet    = jest.fn().mockResolvedValue(undefined);
  const mockUpdate = jest.fn().mockResolvedValue(undefined);
  customersRef.mockReturnValue({
    doc: jest.fn().mockReturnValue({
      set: mockSet,
      update: mockUpdate,
      get: jest.fn().mockResolvedValue({ data: () => null }),
    }),
  });
}

function inMsg(overrides = {}) {
  return {
    from: CUSTOMER_PHONE,
    contactName: 'Ahmet',
    type: 'text',
    text: '',
    id: null,
    items: null,
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WHATSAPP_FLOW_ID = 'flow_test_id';

  // WhatsApp stubs
  sendText.mockResolvedValue('wamid_stub');
  sendButtonMessage.mockResolvedValue('wamid_btn');
  sendFlowMessage.mockResolvedValue(null);
  sendListMessage.mockResolvedValue('wamid_list');
  sendLocationRequest.mockResolvedValue(undefined);
  deleteMessage.mockResolvedValue(undefined);

  // Session store stubs
  setSession.mockResolvedValue(undefined);

  // Menu + business info stubs
  getMenu.mockResolvedValue(MENU);
  getBusinessInfo.mockResolvedValue(BIZ_INFO);

  // Schedule: restaurant is always open in E2E tests
  isOpenNow.mockReturnValue(true);
  isOrderingOpen.mockReturnValue(true);
  getTodayOrderWindow.mockReturnValue({ firstOrderTime: '10:00', lastOrderTime: '22:00' });

  // Distance sort: identity
  sortByDistance.mockImplementation((items) => items);
});

afterEach(() => {
  delete process.env.WHATSAPP_FLOW_ID;
});

// ── Test suite: pickup order workflow ─────────────────────────────────────────

describe('E2E: Pickup order workflow — place → owner notified → mark ready → customer notified', () => {

  test('Step 1: placing order notifies owner with items and total', async () => {
    makeOrdersRefForCreate();
    makeBusinessRef();
    makeCustomersRef();

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
      specialRequests: '',
      pendingDeleteIds: [],
    });

    await handleMessage(ROUTING, inMsg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    const ownerCall = sendText.mock.calls.find(([to]) => to === OWNER_PHONE);
    expect(ownerCall).toBeDefined();
    expect(ownerCall[1]).toContain('Döner');
    expect(ownerCall[1]).toContain('€17.00');
  });

  test('Step 1: placing order sends receipt to customer with order ID', async () => {
    makeOrdersRefForCreate();
    makeBusinessRef();
    makeCustomersRef();

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
      specialRequests: '',
      pendingDeleteIds: [],
    });

    await handleMessage(ROUTING, inMsg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    const customerCall = sendText.mock.calls.find(([to]) => to === CUSTOMER_PHONE);
    expect(customerCall).toBeDefined();
    // shortId = last 6 chars of ORDER_ID uppercased = 'ETEST' ... wait ORDER_ID = 'order_E2ETEST' → 'ETEST' is 5 chars, slice(-6) = '2ETEST'
    expect(customerCall[1]).toContain(ORDER_ID.slice(-6).toUpperCase());
  });

  test('Step 2: markReady sends "ready for pickup" notification to customer', async () => {
    makeOrdersRefForTransition('preparing');

    await markReady(BIZ, ORDER_ID);

    expect(sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), 'PH_E2E');
  });

  test('Step 2: markReady updates Firestore status to "ready"', async () => {
    const mockUpdate = makeOrdersRefForTransition('preparing');

    await markReady(BIZ, ORDER_ID);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
  });

  test('Full chain: place → owner notified → mark ready → customer notified', async () => {
    // ── Phase 1: Customer places order ───────────────────────────────────────
    makeOrdersRefForCreate();
    makeBusinessRef();
    makeCustomersRef();

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
      specialRequests: '',
      pendingDeleteIds: [],
    });

    await handleMessage(ROUTING, inMsg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    // Owner must have been notified
    const ownerCall = sendText.mock.calls.find(([to]) => to === OWNER_PHONE);
    expect(ownerCall).toBeDefined();

    // Customer must have received a receipt
    const receiptCall = sendText.mock.calls.find(([to]) => to === CUSTOMER_PHONE);
    expect(receiptCall).toBeDefined();

    // ── Phase 2: Owner marks order ready ─────────────────────────────────────
    sendText.mockClear();
    makeOrdersRefForTransition('preparing');

    await markReady(BIZ, ORDER_ID);

    // Customer must be notified that the order is ready
    expect(sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), 'PH_E2E');
  });

});

// ── Test suite: full 9-state pickup path ──────────────────────────────────────

describe('E2E: Full pickup status path — pending → approved → preparing → ready → picked_up', () => {

  test('approveOrder: notifies customer and updates status', async () => {
    const mockUpdate = makeOrdersRefForTransition('pending');
    await approveOrder(BIZ, ORDER_ID);

    expect(sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), 'PH_E2E');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  test('startPreparation: notifies customer and updates status', async () => {
    const mockUpdate = makeOrdersRefForTransition('approved');
    await startPreparation(BIZ, ORDER_ID);

    expect(sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), 'PH_E2E');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'preparing' }));
  });

  test('markReady: notifies customer and updates status', async () => {
    const mockUpdate = makeOrdersRefForTransition('preparing');
    await markReady(BIZ, ORDER_ID);

    expect(sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), 'PH_E2E');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', readyAt: expect.any(String) }));
  });

});

// ── Test suite: delivery order workflow ───────────────────────────────────────

describe('E2E: Delivery order workflow — place → owner notified → mark on_the_way → customer notified', () => {

  test('delivery order: owner notification includes delivery label and address', async () => {
    makeOrdersRefForCreate();
    makeBusinessRef();
    makeCustomersRef();
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryFee: 2.50 });

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'confirming',
      businessId: BIZ,
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ahmet',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      specialRequests: '',
      pendingDeleteIds: [],
    });

    await handleMessage(ROUTING, inMsg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    const ownerCall = sendText.mock.calls.find(([to]) => to === OWNER_PHONE);
    expect(ownerCall).toBeDefined();
    expect(ownerCall[1]).toContain('Delivery');
    expect(ownerCall[1]).toContain('Mariahilfer Str. 10');
    expect(ownerCall[1]).toContain('€11.00'); // 8.50 + 2.50
  });

  test('delivery order full chain: place → owner notified → mark on_the_way → customer notified', async () => {
    const { markOnTheWay } = require('../bot/orderService');

    // Phase 1: place order
    makeOrdersRefForCreate();
    makeBusinessRef();
    makeCustomersRef();
    getBusinessInfo.mockResolvedValue({ ...BIZ_INFO, deliveryFee: 2.50 });

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'confirming',
      businessId: BIZ,
      orderType: 'delivery',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ahmet',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      specialRequests: '',
      pendingDeleteIds: [],
    });

    await handleMessage(ROUTING, inMsg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    expect(sendText.mock.calls.find(([to]) => to === OWNER_PHONE)).toBeDefined();

    // Phase 2: owner marks on the way
    sendText.mockClear();
    makeOrdersRefForTransition('preparing');

    await markOnTheWay(BIZ, ORDER_ID);

    expect(sendText).toHaveBeenCalledWith(CUSTOMER_PHONE, expect.any(String), 'PH_E2E');
  });

});

// ── Test suite: error resilience ──────────────────────────────────────────────

describe('E2E: Error resilience', () => {

  test('order is still created when owner WhatsApp notification fails', async () => {
    // sendText fails for owner but should not bubble up
    sendText.mockImplementation(async (to) => {
      if (to === OWNER_PHONE) throw new Error('WhatsApp API error');
      return 'wamid_stub';
    });

    makeOrdersRefForCreate();
    makeBusinessRef();
    makeCustomersRef();

    getSession.mockResolvedValue({
      language: 'tr',
      state: 'confirming',
      businessId: BIZ,
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
      specialRequests: '',
      pendingDeleteIds: [],
    });

    // Should resolve without throwing
    await expect(
      handleMessage(ROUTING, inMsg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }))
    ).resolves.toBeUndefined();

    // Customer still receives receipt
    const customerCall = sendText.mock.calls.find(([to]) => to === CUSTOMER_PHONE);
    expect(customerCall).toBeDefined();
  });

  test('markReady does not throw when customer notification fails', async () => {
    makeOrdersRefForTransition('preparing');
    sendText.mockRejectedValue(new Error('WhatsApp down'));

    await expect(markReady(BIZ, ORDER_ID)).resolves.toBeUndefined();
  });

});
