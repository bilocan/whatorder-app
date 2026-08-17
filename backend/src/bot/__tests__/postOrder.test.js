jest.mock('../sessionStore');
jest.mock('../../lib/whatsapp');
jest.mock('../templates');
jest.mock('../menuService');
jest.mock('../orderService');
jest.mock('../featureFlags');
jest.mock('../reorder');
jest.mock('../../lib/paymentService');

const { patchSession } = require('../sessionStore');
const { sendText, sendButtonMessage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { getBusinessInfo } = require('../menuService');
const {
  getOrder,
  cancelOrder,
  getLastOrderForCustomer,
} = require('../orderService');
const { isConversationalBasket } = require('../featureFlags');
const { startRestaurantBrowsing } = require('../reorder');
const { refundOrderPayment } = require('../../lib/paymentService');
const {
  canCustomerCancel,
  detectCancelOrderRequest,
  tryReplyOrderStatus,
  tryHandlePostOrderMessage,
  handlePostOrderCancelButton,
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
  startRestaurantBrowsing.mockResolvedValue(undefined);
  refundOrderPayment.mockResolvedValue({ refunded: false, skipped: true });
});

describe('canCustomerCancel', () => {
  test('allows cancel when pending', () => {
    expect(canCustomerCancel({ status: 'pending' })).toBe(true);
  });

  test('allows cancel when approved (before preparing)', () => {
    expect(canCustomerCancel({ status: 'approved' })).toBe(true);
  });

  test('blocks cancel when preparing', () => {
    expect(canCustomerCancel({ status: 'preparing' })).toBe(false);
  });

  test('blocks cancel when ready', () => {
    expect(canCustomerCancel({ status: 'ready' })).toBe(false);
  });
});

describe('detectCancelOrderRequest', () => {
  test('matches cancel phrases', () => {
    expect(detectCancelOrderRequest('stornieren', 'stornieren')).toBe(true);
    expect(detectCancelOrderRequest('cancel order', 'cancel order')).toBe(true);
    expect(detectCancelOrderRequest('bestellung stornieren', 'bestellung stornieren')).toBe(true);
    expect(detectCancelOrderRequest('iptal', 'iptal')).toBe(true);
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

describe('handlePostOrderCancelButton', () => {
  const baseSession = {
    pendingAmendOrderId: ORDER_ID,
    pendingAmendPlacedAt: Date.now(),
    whatsappPhoneNumberId: null,
  };

  test('cancels cash order when pending and offers reorder', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending', paymentMethod: 'cash' });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(refundOrderPayment).not.toHaveBeenCalled();
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true, paymentRefunded: false });
    expect(patchSession).toHaveBeenCalled();
    expect(startRestaurantBrowsing).toHaveBeenCalledWith(expect.objectContaining({ from: FROM, businessId: BIZ }));
  });

  test('cancels cash order when approved (before preparing) and offers reorder', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'approved', paymentMethod: 'cash' });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true, paymentRefunded: false });
    expect(startRestaurantBrowsing).toHaveBeenCalledWith(expect.objectContaining({ from: FROM, businessId: BIZ }));
  });

  test('sends too-late message when already preparing', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'preparing', paymentMethod: 'cash' });

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCancelTooLatePreparing', null);
  });

  test('routes stripe preparing order to too-late (no self-serve refund)', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'preparing', paymentMethod: 'stripe' });

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(refundOrderPayment).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCancelTooLatePreparing', null);
  });

  test('too-late on the way uses delivery-specific copy', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'on_the_way', paymentMethod: 'stripe' });

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'tr', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(refundOrderPayment).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCancelTooLateOnTheWay', null);
  });

  test('too-late after delivered uses delivered-specific copy', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'delivered', paymentMethod: 'stripe' });

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'tr', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(refundOrderPayment).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCancelTooLateDelivered', null);
  });

  test('too-late after delivered uses delivered-specific copy', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'delivered', paymentMethod: 'stripe' });

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'tr', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(refundOrderPayment).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCancelTooLateDelivered', null);
  });

  test('refunds then cancels stripe order when pending', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending', paymentMethod: 'stripe', paymentStatus: 'paid' });
    refundOrderPayment.mockResolvedValue({ refunded: true, skipped: false, refundId: 're_1' });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(refundOrderPayment).toHaveBeenCalledWith(BIZ, ORDER_ID, expect.objectContaining({
      reason: 'customer_cancel',
      actor: 'customer',
      notifyCustomer: false,
    }));
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true, paymentRefunded: true });
    expect(startRestaurantBrowsing).toHaveBeenCalled();
  });

  test('falls back to last order when pendingAmendOrderId is missing', async () => {
    getLastOrderForCustomer.mockResolvedValue({
      id: ORDER_ID,
      status: 'pending',
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
    });
    refundOrderPayment.mockResolvedValue({ refunded: true, skipped: false, refundId: 're_1' });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await handlePostOrderCancelButton({
      from: FROM, session: { whatsappPhoneNumberId: null }, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(getLastOrderForCustomer).toHaveBeenCalledWith(BIZ, FROM);
    expect(refundOrderPayment).toHaveBeenCalled();
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true, paymentRefunded: true });
  });

  test('falls back gracefully when no pendingAmendOrderId and no last order', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    const handled = await handlePostOrderCancelButton({
      from: FROM, session: { whatsappPhoneNumberId: null }, lang: 'de', businessId: BIZ,
    });

    expect(handled).toBe(true);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCallRestaurant', null);
  });
});
describe('tryHandlePostOrderMessage', () => {
  const baseSession = {
    pendingAmendOrderId: ORDER_ID,
    pendingAmendPlacedAt: Date.now(),
    whatsappPhoneNumberId: null,
  };

  test('cancels cash pending order on stornieren text', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending', paymentMethod: 'cash' });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await tryHandlePostOrderMessage({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
      text: 'stornieren', norm: 'stornieren',
    });

    expect(handled).toBe(true);
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true, paymentRefunded: false });
  });

  test('cancels cash approved order on iptal text', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'approved', paymentMethod: 'cash' });
    cancelOrder.mockResolvedValue(undefined);

    const handled = await tryHandlePostOrderMessage({
      from: FROM, session: baseSession, lang: 'tr', businessId: BIZ,
      text: 'iptal', norm: 'iptal',
    });

    expect(handled).toBe(true);
    expect(cancelOrder).toHaveBeenCalledWith(BIZ, ORDER_ID, { skipReentry: true, paymentRefunded: false });
  });

  test('order text after placement routes to call-restaurant (no add-on)', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending', paymentMethod: 'cash' });

    const handled = await tryHandlePostOrderMessage({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
      text: 'noch ein ayran', norm: 'noch ein ayran',
    });

    expect(handled).toBe(true);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCallRestaurant', null);
  });

  test('stripe order text routes to call-restaurant', async () => {
    getOrder.mockResolvedValue({ id: ORDER_ID, status: 'pending', paymentMethod: 'stripe' });

    const handled = await tryHandlePostOrderMessage({
      from: FROM, session: baseSession, lang: 'de', businessId: BIZ,
      text: 'noch ein ayran', norm: 'noch ein ayran',
    });

    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCallRestaurant', null);
  });

  test('returns false and clears session when context expired (> 1h)', async () => {
    const staleSession = {
      ...baseSession,
      pendingAmendPlacedAt: Date.now() - 2 * 60 * 60 * 1000,
    };

    const handled = await tryHandlePostOrderMessage({
      from: FROM, session: staleSession, lang: 'de', businessId: BIZ,
      text: 'noch ein ayran', norm: 'noch ein ayran',
    });

    expect(handled).toBe(false);
    expect(patchSession).toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  test('cancel text without pendingAmend still handles via last-order fallback', async () => {
    getLastOrderForCustomer.mockResolvedValue(null);
    const handled = await tryHandlePostOrderMessage({
      from: FROM, session: {}, lang: 'de', businessId: BIZ,
      text: 'stornieren', norm: 'stornieren',
    });
    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(FROM, 'postOrderCallRestaurant', null);
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
