jest.mock('../../lib/firebase', () => ({
  db: {},
  admin: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
}));
jest.mock('../../bot/botHandler');
jest.mock('../../lib/collections');

const { verifyWebhook, receiveWebhook } = require('../webhookController');
const { handleMessage } = require('../../bot/botHandler');
const { phoneRoutingRef, processedMessageRef } = require('../../lib/collections');

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
          messages: [{ id: 'wamid_test', from: '+43123', type: 'text', text: { body: 'Hi' }, ...msgOverride }],
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
    processedMessageRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn().mockResolvedValue(undefined),
    });
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.NODE_ENV;
  });

  test('200 ok when body has no message', async () => {
    const req = { body: {} };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
    expect(handleMessage).not.toHaveBeenCalled();
  });

  test('resolves routing from Firestore when snap exists', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null }) }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_a', 'biz_b'], defaultBusinessId: null, phoneNumberId: 'PH_ID' },
      expect.any(Object),
    );
  });

  test('newly added restaurant appears when businessIds array grows to 3 entries', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a', 'biz_b', 'biz_c'], defaultBusinessId: 'biz_a' }),
      }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_a', 'biz_b', 'biz_c'], defaultBusinessId: 'biz_a', phoneNumberId: 'PH_ID' },
      expect.any(Object),
    );
  });

  test('removed restaurant is absent when businessIds array shrinks back to 1', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a'], defaultBusinessId: 'biz_a' }),
      }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: ['biz_a'], defaultBusinessId: 'biz_a', phoneNumberId: 'PH_ID' },
      expect.any(Object),
    );
    const routing = handleMessage.mock.calls[0][0];
    expect(routing.businessIds).not.toContain('biz_b');
    expect(routing.businessIds).not.toContain('biz_c');
  });

  test('returns empty routing when phoneRouting snap does not exist', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      { businessIds: [], defaultBusinessId: null, phoneNumberId: 'PH_ID' },
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

  test('processes nfm_reply as flow_completion', async () => {
    const payload = { item_id: 'abc', protein: 'Chicken', quantity: '1', sauces_text: 'None', special_requests: '-', total: '€8.50', unit_price: '8.50' };
    const req = { body: webhookBody({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: JSON.stringify(payload) } } }) };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: 'flow_completion', data: payload }),
    );
  });

  test('200 ok for unknown interactive type', async () => {
    const req = { body: webhookBody({ type: 'interactive', interactive: { type: 'unknown_type' } }) };
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
    expect(processedMessageRef().set).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('skips duplicate wamid without calling handleMessage', async () => {
    processedMessageRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true }),
      set: jest.fn(),
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(handleMessage).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  test('marks wamid processed after successful handleMessage', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a'], defaultBusinessId: 'biz_a' }),
      }),
    });
    const setMock = jest.fn().mockResolvedValue(undefined);
    processedMessageRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: setMock,
    });
    const req = { body: webhookBody() };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_a' }));
  });

  test('401 when signature required but missing', async () => {
    process.env.WHATSAPP_APP_SECRET = 'secret';
    const req = { body: webhookBody(), headers: {} };
    const res = makeRes();
    await receiveWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(handleMessage).not.toHaveBeenCalled();
  });
});
