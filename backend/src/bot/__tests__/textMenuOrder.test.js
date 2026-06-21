const { patchSession } = require('../sessionStore');
const { sendButtonMessage } = require('../../lib/whatsapp');
const { tryNumberSelectionOrder } = require('../textMenuOrder');

jest.mock('../sessionStore', () => {
  const actual = jest.requireActual('../sessionStore');
  return { ...actual, patchSession: jest.fn() };
});
jest.mock('../../lib/whatsapp');
jest.mock('../intentOrder', () => ({
  buildIntentConfirmBody: jest.fn(() => 'confirm body'),
}));

describe('tryNumberSelectionOrder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendButtonMessage.mockResolvedValue('btn_msg');
    patchSession.mockResolvedValue(undefined);
  });

  test('accepts single digit selection when textMenuCategory is set', async () => {
    const session = {
      state: 'browsing',
      language: 'en',
      businessId: 'biz_test',
      basket: [],
      textMenuCategory: 'Pizza',
      textMenuIndex: [
        { id: 'p1', name: 'Margherita', price: 8.5 },
        { id: 'p2', name: 'Pepperoni', price: 9.0 },
      ],
    };

    const handled = await tryNumberSelectionOrder({
      from: '+43699000001',
      session,
      lang: 'en',
      businessId: 'biz_test',
      basket: [],
      text: '1',
    });

    expect(handled).toBe(true);
    expect(sendButtonMessage).toHaveBeenCalled();
    expect(patchSession).toHaveBeenNthCalledWith(1, '+43699000001', expect.objectContaining({
      pendingIntentItems: [expect.objectContaining({ menuItemId: 'p1', name: 'Margherita', qty: 1 })],
      textMenuIndex: session.textMenuIndex,
      textMenuCategory: 'Pizza',
    }), session);
    expect(patchSession).toHaveBeenNthCalledWith(2, '+43699000001', { pendingDeleteIds: ['btn_msg'] });
  });
});
