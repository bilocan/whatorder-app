jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../sessionStore');
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');

const { handleMessage } = require('../botHandler');
const { getSession, setSession } = require('../sessionStore');
const { getMenu, getBusinessInfo } = require('../menuService');
const { createOrder } = require('../orderService');
const { sendText, sendButtonMessage, sendCatalogMessage } = require('../../lib/whatsapp');

const BIZ = 'biz_test';
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
  sendButtonMessage.mockResolvedValue();
  sendCatalogMessage.mockResolvedValue();
});

function msg(overrides) {
  return { from: FROM, contactName: 'Test User', type: 'text', text: '', id: null, items: null, ...overrides };
}

describe('Full flow: language detection → catalog → cart → special requests → name → confirm → order', () => {

  test('Step 1: first message triggers language detection and shows catalog', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(BIZ, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expect(sendCatalogMessage).toHaveBeenCalledWith(FROM, 'cat_123', expect.stringContaining('Döner Palace'));
  });

  test('Step 2: cart_submitted moves to awaiting_special_requests and shows prompt', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing' });

    await handleMessage(BIZ, msg({
      type: 'cart_submitted',
      items: [{ productId: 'item_1', qty: 2, price: 8.50, currency: 'EUR' }],
    }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_special_requests',
      pendingCart: [{ name: 'Döner', qty: 2, price: 8.50 }],
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
      pendingCart: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(BIZ, msg({ text: 'No onions please' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      specialRequests: 'No onions please',
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.any(String));
  });

  test('Step 3b: btn_skip_requests moves to awaiting_name with empty notes', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_special_requests',
      pendingCart: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'btn_skip_requests', title: 'Atla' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      specialRequests: '',
    }));
  });

  test('Step 4: user sends name → shows final confirm button message', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_name',
      pendingCart: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
      specialRequests: '',
    });

    await handleMessage(BIZ, msg({ text: 'Ahmet' }));

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
      pendingCart: [{ name: 'Döner', qty: 2, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
      specialRequests: 'Extra spicy',
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

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
      pendingCart: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

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

    await handleMessage(BIZ, msg({ text }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: expectedLang }));
  });
});

describe('Edge cases', () => {
  test('empty cart_submitted shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(BIZ, msg({ type: 'cart_submitted', items: [] }));

    expect(sendCatalogMessage).toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  test('catalogUnavailable shown when business has no catalogId', async () => {
    getBusinessInfo.mockResolvedValue({ name: 'Test', avgPrepTime: 30 }); // no catalogId
    getSession.mockResolvedValue({});

    await handleMessage(BIZ, msg({ text: 'Hello' }));

    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('catalog'));
  });

  test('unknown productId falls back to productId as name', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(BIZ, msg({
      type: 'cart_submitted',
      items: [{ productId: 'unknown_99', qty: 1, price: 5.00, currency: 'EUR' }],
    }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      pendingCart: [{ name: 'unknown_99', qty: 1, price: 5.00 }],
    }));
  });

  test('default text in browsing state shows catalog', async () => {
    getSession.mockResolvedValue({ language: 'en', state: 'browsing' });

    await handleMessage(BIZ, msg({ text: 'something random' }));

    expect(sendCatalogMessage).toHaveBeenCalled();
  });
});
