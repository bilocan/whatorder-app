jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../bot/orderService');
jest.mock('../../lib/receiptService');
jest.mock('../../lib/dashboardAuth', () => ({
  requireOwnerOrAdmin: (_req, _res, next) => next(),
  requireOwnerOfBusiness: (_req, _res, next) => next(),
}));

const request = require('supertest');
const app = require('../../index');
const {
  approveOrder, rejectOrder, startPreparation,
  markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder,
} = require('../../bot/orderService');
const { getReceiptDownload, resendReceiptWhatsApp } = require('../../lib/receiptService');

beforeEach(() => jest.clearAllMocks());

const TRANSITIONS = [
  { path: 'approve',    fn: approveOrder },
  { path: 'reject',     fn: rejectOrder },
  { path: 'prepare',    fn: startPreparation },
  { path: 'ready',      fn: markReady },
  { path: 'on-the-way', fn: markOnTheWay },
  { path: 'picked-up',  fn: markPickedUp },
  { path: 'delivered',  fn: markDelivered },
  { path: 'cancel',     fn: cancelOrder },
];

describe('Order transition endpoints', () => {
  test.each(TRANSITIONS)('POST /businesses/biz1/orders/ord1/$path → 200 ok', async ({ path, fn }) => {
    fn.mockResolvedValue();
    const res = await request(app).post(`/businesses/biz1/orders/ord1/${path}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    if (path === 'approve') {
      expect(fn).toHaveBeenCalledWith('biz1', 'ord1', undefined);
    } else {
      expect(fn).toHaveBeenCalledWith('biz1', 'ord1');
    }
  });

  test('POST .../approve passes owner-supplied etaMinutes from body', async () => {
    approveOrder.mockResolvedValue();
    const res = await request(app)
      .post('/businesses/biz1/orders/ord1/approve')
      .send({ etaMinutes: 45 });
    expect(res.status).toBe(200);
    expect(approveOrder).toHaveBeenCalledWith('biz1', 'ord1', 45);
  });

  test('404 when order not found', async () => {
    approveOrder.mockRejectedValue(new Error('Order not found'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/approve');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Order not found' });
  });

  test('409 on invalid transition', async () => {
    approveOrder.mockRejectedValue(new Error('Invalid transition: ready → approved'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/approve');
    expect(res.status).toBe(409);
  });

  test('409 when Stripe payment still required', async () => {
    approveOrder.mockRejectedValue(new Error('Payment required before kitchen status change'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/approve');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Payment required before kitchen status change' });
  });

  test('500 on unexpected error', async () => {
    approveOrder.mockRejectedValue(new Error('Database connection failed'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/approve');
    expect(res.status).toBe(500);
  });
});

describe('Order receipt endpoints', () => {
  test('GET .../receipt returns download payload', async () => {
    getReceiptDownload.mockResolvedValue({
      belegNumber: 'WO-2026-000001',
      status: 'ready',
      downloadUrl: 'https://signed.example/beleg.pdf',
    });
    const res = await request(app).get('/businesses/biz1/orders/ord1/receipt');
    expect(res.status).toBe(200);
    expect(res.body.belegNumber).toBe('WO-2026-000001');
    expect(res.body.downloadUrl).toContain('signed.example');
  });

  test('GET .../receipt → 404 when missing', async () => {
    const err = new Error('No receipt for this order');
    err.code = 'NOT_FOUND';
    getReceiptDownload.mockRejectedValue(err);
    const res = await request(app).get('/businesses/biz1/orders/ord1/receipt');
    expect(res.status).toBe(404);
  });

  test('GET .../receipt → 409 when not ready', async () => {
    const err = new Error('Receipt generation failed');
    err.code = 'CONFLICT';
    getReceiptDownload.mockRejectedValue(err);
    const res = await request(app).get('/businesses/biz1/orders/ord1/receipt');
    expect(res.status).toBe(409);
  });

  test('POST .../receipt/resend → 200', async () => {
    resendReceiptWhatsApp.mockResolvedValue({ status: 'ok', belegNumber: 'WO-2026-000001' });
    const res = await request(app).post('/businesses/biz1/orders/ord1/receipt/resend');
    expect(res.status).toBe(200);
    expect(resendReceiptWhatsApp).toHaveBeenCalledWith('biz1', 'ord1');
  });

  test('POST .../receipt/resend → 409 when not ready', async () => {
    const err = new Error('Receipt not ready');
    err.code = 'CONFLICT';
    resendReceiptWhatsApp.mockRejectedValue(err);
    const res = await request(app).post('/businesses/biz1/orders/ord1/receipt/resend');
    expect(res.status).toBe(409);
  });
});
