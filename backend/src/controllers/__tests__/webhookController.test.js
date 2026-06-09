jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../bot/botHandler');
jest.mock('../../lib/collections');

const { verifyWebhook, receiveWebhook } = require('../webhookController');
const { handleMessage } = require('../../bot/botHandler');
const { phoneRoutingRef } = require('../../lib/collections');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function webhookBody(msgOverride = {}) {
  return {
    entry: [{
      changes: [{
        value: {
          messages: [{ from: '+43123', type: 'text', text: { body: 'Hi' }, ...msgOverride }],
          contacts: [{ profile: { name: 'Test User' } }],
          metadata: { phone_number_id: 'PH_ID' },
        },
      }],
    }],
  };
}

describe('verifyWebhook', () => {
  const TOKEN = 'verify_secret';
  beforeAll(() => { process.env.WHATSAPP_VERIFY_TOKEN = TOKEN; });

  test('200 + challenge when mode and token match', () => {
    const req = { query: { 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': TOKEN } };
    const res = makeRes();
    verifyWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('abc123');
  });

  test('403 when token does not match', () => {
    const req = { query: { 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': 'wrong' } };
    const res = makeRes();
    verifyWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Invalid token');
  });

  test('403 when mode is not subscribe', () => {
    const req = { query: { 'hub.mode': 'unsubscribe', 'hub.challenge': 'abc123', 'hub.verify_token': TOKEN } };
    const res = makeRes();
    verifyWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('receiveWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    handleMessage.mockResolvedValue();
  });

  test('200 ok when body has no message', async () => {
    const req = { body: {} };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
    expect(handleMessage).not.toHaveBeenCalled();
  });

  test('resolves routing from Firestore when snap exists (old schema)', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ businessId: 'biz_firestore' }) }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_firestore'], defaultBusinessId: 'biz_firestore' },
      expect.any(Object),
    );
  });

  test('resolves routing from Firestore when snap exists (new schema)', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null }) }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null },
      expect.any(Object),
    );
  });

  test('falls back to BUSINESS_ID env when snap does not exist', async () => {
    process.env.BUSINESS_ID = 'biz_env';
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_env'], defaultBusinessId: 'biz_env' },
      expect.any(Object),
    );
    delete process.env.BUSINESS_ID;
  });

  test('falls back to biz_test when no env and snap missing', async () => {
    delete process.env.BUSINESS_ID;
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_test'], defaultBusinessId: 'biz_test' },
      expect.any(Object),
    );
  });

  test('processes text message and returns success', async () => {
    phoneRoutingRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const req = { body: webhookBody({ type: 'text', text: { body: 'Hello' } }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: 'text', text: 'Hello', from: '+43123', contactName: 'Test User' }),
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'success' });
  });

  test('processes list_reply interactive', async () => {
    phoneRoutingRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const req = { body: webhookBody({
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'item_1', title: 'Döner' } },
    }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: 'list_reply', id: 'item_1', title: 'Döner' }),
    );
  });

  test('processes button_reply interactive', async () => {
    phoneRoutingRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const req = { body: webhookBody({
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'btn_yes', title: 'Confirm' } },
    }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: 'button_reply', id: 'btn_yes', title: 'Confirm' }),
    );
  });

  test('200 ok for unknown interactive type', async () => {
    const req = { body: webhookBody({ type: 'interactive', interactive: { type: 'nfm_reply' } }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
    expect(handleMessage).not.toHaveBeenCalled();
  });

  test('processes order (cart) message as cart_submitted', async () => {
    phoneRoutingRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const req = { body: webhookBody({
      type: 'order',
      order: {
        catalog_id: 'cat_123',
        product_items: [
          { product_retailer_id: 'item_1', quantity: 2, item_price: 8.50, currency: 'EUR' },
        ],
      },
    }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        type: 'cart_submitted',
        items: [{ productId: 'item_1', qty: 2, price: 8.50, currency: 'EUR' }],
      }),
    );
    expect(res.json).toHaveBeenCalledWith({ status: 'success' });
  });

  test('200 ok for unknown message type (e.g. image)', async () => {
    const req = { body: webhookBody({ type: 'image' }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
    expect(handleMessage).not.toHaveBeenCalled();
  });

  test('responds 200 success even when handleMessage throws', async () => {
    phoneRoutingRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    handleMessage.mockRejectedValue(new Error('boom'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(res.json).toHaveBeenCalledWith({ status: 'success' });
    consoleSpy.mockRestore();
  });
});
