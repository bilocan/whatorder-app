jest.mock('../sessionStore');
jest.mock('../menuService');
jest.mock('../../lib/whatsapp');

const { setSession } = require('../sessionStore');
const { getMenu } = require('../menuService');
const { sendButtonMessage } = require('../../lib/whatsapp');
const { tryTextIntentOrder } = require('../intentOrder');

const MENU = [
  { id: 'item_1', name: 'Döner', price: 8.50 },
  { id: 'item_2', name: 'Ayran', price: 2.00 },
];

beforeEach(() => {
  jest.clearAllMocks();
  getMenu.mockResolvedValue(MENU);
  sendButtonMessage.mockResolvedValue('msg_1');
  setSession.mockResolvedValue();
});

describe('tryTextIntentOrder', () => {
  test('shows intent confirm for matched order text', async () => {
    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'en', basket: [] },
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: '2x Döner + Ayran',
      norm: '2x döner + ayran',
    });

    expect(handled).toBe(true);
    expect(getMenu).toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalled();
  });

  test('shows both items for "2 Döner 1 ayran"', async () => {
    const handled = await tryTextIntentOrder({
      from: '+43699000001',
      session: { state: 'browsing', language: 'tr', basket: [] },
      lang: 'tr',
      businessId: 'biz_test',
      basket: [],
      text: '2 Döner 1 ayran',
      norm: '2 döner 1 ayran',
    });

    expect(handled).toBe(true);
    const body = sendButtonMessage.mock.calls[0][1].body;
    expect(body).toMatch(/2x Döner/);
    expect(body).toMatch(/1x Ayran/);
  });
});
