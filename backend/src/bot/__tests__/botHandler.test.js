jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../sessionStore');
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../../lib/whatsapp');

const { handleMessage } = require('../botHandler');
const { getSession, setSession } = require('../sessionStore');
const { getMenu, getBusinessInfo } = require('../menuService');
const { createOrder } = require('../orderService');
const { sendText, sendListMessage, sendButtonMessage } = require('../../lib/whatsapp');

const BIZ = 'biz_test';
const FROM = '+43699000001';

const MENU = [
  { id: 'item_1', name: 'Döner',  price: 8.50, category: 'mains',  description: 'Chicken', available: true },
  { id: 'item_2', name: 'Ayran',  price: 2.00, category: 'drinks', description: 'Yogurt drink', available: true },
];

const BIZ_INFO = { name: 'Döner Palace', avgPrepTime: 20 };

beforeEach(() => {
  jest.clearAllMocks();
  getMenu.mockResolvedValue(MENU);
  getBusinessInfo.mockResolvedValue(BIZ_INFO);
  createOrder.mockResolvedValue('order_abc123');
  sendText.mockResolvedValue();
  sendListMessage.mockResolvedValue();
  sendButtonMessage.mockResolvedValue();
});

function msg(overrides) {
  return { from: FROM, contactName: 'Test User', type: 'text', text: '', id: null, ...overrides };
}

describe('Full flow: language detection → menu → quantity → basket → confirm → order', () => {

  test('Step 1: first message triggers language detection and shows menu', async () => {
    getSession.mockResolvedValue({});

    await handleMessage(BIZ, msg({ text: 'Merhaba' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: 'tr', state: 'browsing' }));
    expect(sendListMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      sections: expect.arrayContaining([
        expect.objectContaining({ rows: expect.any(Array) }),
      ]),
    }));
  });

  test('Step 2: list_reply selects item and asks quantity', async () => {
    getSession.mockResolvedValue({ language: 'tr', state: 'browsing', basket: [] });

    await handleMessage(BIZ, msg({ type: 'list_reply', id: 'item_item_1', title: 'Döner' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'selecting',
      pendingItem: { name: 'Döner', price: 8.50 },
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'qty_1' }),
        expect.objectContaining({ id: 'qty_2' }),
      ]),
    }));
  });

  test('Step 3: button_reply qty_2 adds item to basket', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'selecting', basket: [],
      pendingItem: { name: 'Döner', price: 8.50 },
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'qty_2', title: '2' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    }));
    expect(sendButtonMessage).toHaveBeenCalledWith(FROM, expect.objectContaining({
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'btn_view_basket' }),
        expect.objectContaining({ id: 'btn_done' }),
      ]),
    }));
  });

  test('Step 4: btn_confirm shows order summary with pickup time and asks for name', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'browsing',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'btn_confirm', title: 'Onayla' }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({
      state: 'awaiting_name',
      pickupTime: expect.any(String),
      prepMins: 20,
    }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('Döner'));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('⏱️'));
  });

  test('Step 5: user sends name → shows final confirm button message', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'awaiting_name',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      pickupTime: '14:30', prepMins: 20,
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

  test('Step 6: btn_place_order creates order and sends confirmation', async () => {
    getSession.mockResolvedValue({
      language: 'tr', state: 'confirming',
      basket: [{ name: 'Döner', qty: 2, price: 8.50 }],
      customerName: 'Ahmet',
      pickupTime: '14:30',
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'btn_place_order', title: 'Onayla ✅' }));

    expect(createOrder).toHaveBeenCalledWith(BIZ, expect.objectContaining({
      customerName: 'Ahmet',
      items: [{ name: 'Döner', qty: 2, price: 8.50 }],
      total: 17,
      pickupTime: '14:30',
    }));
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ state: 'browsing', basket: [] }));
    expect(sendText).toHaveBeenCalledWith(FROM, expect.stringContaining('ABC123'));
  });

});

describe('Cancel flow', () => {
  test('btn_cancel_order clears basket and shows menu', async () => {
    getSession.mockResolvedValue({
      language: 'en', state: 'confirming',
      basket: [{ name: 'Döner', qty: 1, price: 8.50 }],
      customerName: 'John',
    });

    await handleMessage(BIZ, msg({ type: 'button_reply', id: 'btn_cancel_order', title: 'Cancel ❌' }));

    expect(createOrder).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ basket: [] }));
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

    await handleMessage(BIZ, msg({ text }));

    expect(setSession).toHaveBeenCalledWith(FROM, expect.objectContaining({ language: expectedLang }));
  });
});
