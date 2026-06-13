jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../bot/orderService');

const request = require('supertest');
const app = require('../../index');
const {
  approveOrder, rejectOrder, startPreparation,
  markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder,
} = require('../../bot/orderService');

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
    expect(fn).toHaveBeenCalledWith('biz1', 'ord1');
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

  test('500 on unexpected error', async () => {
    approveOrder.mockRejectedValue(new Error('Database connection failed'));
    const res = await request(app).post('/businesses/biz1/orders/ord1/approve');
    expect(res.status).toBe(500);
  });
});
