jest.mock('../sessionStore');
jest.mock('../../lib/whatsapp');
jest.mock('../templates');
jest.mock('../menuService');
jest.mock('../basketOps');
jest.mock('../orderService');
jest.mock('../featureFlags');

const { patchSession } = require('../sessionStore');
const { sendText, sendButtonMessage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { getBusinessInfo, getMenuContext } = require('../menuService');
const { parseBasketOps } = require('../basketOps');
const {
  getOrder,
  amendOrderAddItems,
  cancelOrder,
  getLastOrderForCustomer,
} = require('../orderService');
const { isConversationalBasket } = require('../featureFlags');
const {
  isAmendWindowOpen,
  detectCancelOrderRequest,
  tryReplyOrderStatus,
  tryHandlePostOrderMessage,
  recordParseFailure,
  isHumanHandoffButton,
} = require('../postOrder');

const FROM = '+43699000001';
const BIZ = 'biz_test';
const ORDER_ID = 'order_abc123456789';

beforeEach(() => {
  jest.clearAllMocks();
  t.mockImplementation((key) => key);
  sendText.mockResolvedValue(undefined);
  sendButtonMessage.mockResolvedValue(undefined);
  patchSession.mockResolvedValue(undefined);
  getBusinessInfo.mockResolvedValue({
    name: 'Enes',
    alertPhone: '+431234567',
    conversationalBasket: true,
  });
  isConversationalBasket.mockReturnValue(true);
});

describe('isAmendWindowOpen', () => {
  test('open for pending order within window', () => {
    const placedAt = Date.now() - 60_000;
    expect(isAmendWindowOpen({ status: 'pending' }, placedAt)).toBe(true);
  });

  test('closed after owner accepts', () => {
    expect(isAmendWindowOpen({ status: 'approved' }, Date.now())).toBe(false);
  });

  test('closed after window expires', () => {
    const placedAt = Date.now() - 20 * 60 * 1000;
    expect(isAmendWindowOpen({ status: 'pending' }, placedAt)).toBe(false);
  });
});

describe('detectCancelOrderRequest', () => {
  test('matches cancel phrases', () => {
    expect(detectCancelOrderRequest('stornieren', 'stornieren')).toBe(true);
    expect(detectCancelOrderRequest('cancel order', 'cancel order')).toBe(true);
    expect(detectCancelOrderRequest('bestellung stornieren', 'bestellung stornieren')).toBe(true);
  });

  test('does not match food orders', () => {
    expect(detectCancelOrderRequest('2 döner', '2 döner')).toBe(false);
  });
});

describe('tryReplyOrderStatus', () => {
  test('replies with pending status', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending' });
    const handled = await tryReplyOrderStatus({
      from: FROM,
      session: { pendingAmendOrderId: ORDER_ID, whatsappPhoneNumberId: null },
      lang: 'de',
      businessId: BIZ,
      text: 'wo bleibt meine bestellung',
    });
    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(FROM, 'orderStatusPending', null);
  });

  test('uses last order when no pending amend id', async () => {
    getLastOrderForCustomer.mockResolvedValue({ id: ORDER_ID, status: 'preparing' });
    const handled = await tryReplyOrderStatus({
      from: FROM,
      session: {},
      lang: 'de',
      businessId: BIZ,
      text: 'where is my order',
    });
    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(FROM, 'orderPreparing', null);
  });
});

describe('tryHandlePostOrderMessage', () => {
  const baseSession = {
    pendingAmendOrderId: ORDER_ID,
    pendingAmendPlacedAt: Date.now(),
    whatsappPhoneNumberId: null,
  };

  test('cancels cash order in amend window', async () => {
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      paymentMethod: 'cash',
      items: [{ name: 'Döner', qty: 1, price: 8 }],
    });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await tryHandlePostOrderMessage({
      from: FROM,
      session: baseSession,
      lang: 'de',
      businessId: BIZ,
      text: 'stornieren',
      norm: 'stornieren',
    });

    expect(handled).toBe(true);
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID);
    expect(patchSession).toHaveBeenCalled();
  });

  test('directs card orders to call restaurant', async () => {
    getOrder.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      paymentMethod: 'stripe',
      items: [],
    });

    const handled = await tryHandlePostOrderMessage({
      from: FROM,
      session: baseSession,
      lang: 'de',
      businessId: BIZ,
      text: 'noch ein ayran',
      norm: 'noch ein ayran',
    });

    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCallRestaurant', null);
    expect(amendOrderAddItems).not.toHaveBeenCalled();
  });

  test('amends cash order with parsed add-ons', async () => {
    getOrder
      .mockResolvedValueOnce({
        id: ORDER_ID,
        status: 'pending',
        paymentMethod: 'cash',
        items: [{ name: 'Döner', qty: 1, price: 8 }],
      })
      .mockResolvedValueOnce({
        id: ORDER_ID,
        status: 'pending',
        paymentMethod: 'cash',
        items: [
          { name: 'Döner', qty: 1, price: 8 },
          { name: 'Ayran', qty: 1, price: 2.5 },
        ],
        total: 10.5,
      });
    getMenuContext.mockResolvedValue({ menu: [], menuMatch: null, menuTokenIndex: null });
    parseBasketOps.mockResolvedValue({
      outcome: 'ops',
      ops: [{ type: 'add', item: { name: 'Ayran', qty: 1, price: 2.5 } }],
    });
    amendOrderAddItems.mockResolvedValue({ applied: [{ name: 'Ayran', qty: 1, price: 2.5 }], total: 10.5 });

    const handled = await tryHandlePostOrderMessage({
      from: FROM,
      session: baseSession,
      lang: 'de',
      businessId: BIZ,
      text: 'noch ein ayran',
      norm: 'noch ein ayran',
    });

    expect(handled).toBe(true);
    expect(amendOrderAddItems).toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderAmended', null);
  });
});

describe('recordParseFailure', () => {
  test('offers handoff after two failures', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    const offered = await recordParseFailure({
      from: FROM,
      session: { consecutiveParseFailures: 1, state: 'browsing', basket: [] },
      lang: 'de',
      businessId: BIZ,
      text: 'xyz gibberish',
    });
    expect(offered).toBe(true);
    expect(sendButtonMessage).toHaveBeenCalled();
    expect(patchSession).toHaveBeenCalledWith(FROM, { consecutiveParseFailures: 2 }, expect.anything());
  });
});

describe('isHumanHandoffButton', () => {
  test('recognizes handoff button id', () => {
    expect(isHumanHandoffButton('btn_human_handoff')).toBe(true);
    expect(isHumanHandoffButton('btn_confirm')).toBe(false);
  });
});
