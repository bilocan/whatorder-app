jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../bot/orderService');

const request = require('supertest');
const app = require('../../index');
const { markOrderReady } = require('../../bot/orderService');

beforeEach(() => jest.clearAllMocks());

describe('POST /businesses/:businessId/orders/:orderId/ready', () => {
  test('200 ok on success', async () => {
    markOrderReady.mockResolvedValue();
    const res = await request(app).post('/businesses/biz1/orders/ord1/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(markOrderReady).toHaveBeenCalledWith('biz1', 'ord1');
  });

  test('404 when order not found', async () => {
    markOrderReady.mockRejectedValue(new Error('Order not found'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/ready');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Order not found' });
  });

  test('409 when order is not pending', async () => {
    markOrderReady.mockRejectedValue(new Error('Order is not pending'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/ready');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Order is not pending' });
  });

  test('500 on unexpected error', async () => {
    markOrderReady.mockRejectedValue(new Error('Database connection failed'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/ready');
    expect(res.status).toBe(500);
  });
});

describe('POST /orders/:orderId/ready (legacy alias)', () => {
  test('200 ok on success', async () => {
    markOrderReady.mockResolvedValue();
    const res = await request(app).post('/orders/ord1/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(markOrderReady).toHaveBeenCalledWith(expect.any(String), 'ord1');
  });

  test('404 when order not found', async () => {
    markOrderReady.mockRejectedValue(new Error('Order not found'));
    const res = await request(app).post('/orders/ord1/ready');
    expect(res.status).toBe(404);
  });

  test('409 when order is not pending', async () => {
    markOrderReady.mockRejectedValue(new Error('Order is not pending'));
    const res = await request(app).post('/orders/ord1/ready');
    expect(res.status).toBe(409);
  });

  test('500 on unexpected error', async () => {
    markOrderReady.mockRejectedValue(new Error('Unexpected'));
    const res = await request(app).post('/orders/ord1/ready');
    expect(res.status).toBe(500);
  });
});
