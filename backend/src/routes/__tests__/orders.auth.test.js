jest.mock('../../lib/firebase', () => ({
  db: {},
  admin: {
    auth: jest.fn(),
  },
}));
jest.mock('../../lib/collections', () => ({
  ownerRef: jest.fn(),
  adminRef: jest.fn(),
}));
jest.mock('../../bot/orderService', () => ({
  approveOrder: jest.fn().mockResolvedValue(),
  rejectOrder: jest.fn(),
  startPreparation: jest.fn(),
  markReady: jest.fn(),
  markOnTheWay: jest.fn(),
  markPickedUp: jest.fn(),
  markDelivered: jest.fn(),
  cancelOrder: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');
const { ownerRef, adminRef } = require('../../lib/collections');

let mockAuth;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'owner-uid' }),
  };
  admin.auth.mockReturnValue(mockAuth);
  ownerRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ businessId: 'biz1' }),
    }),
  });
  adminRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({ exists: false }),
  });
});

describe('order route auth (requireOwnerOfBusiness)', () => {
  test('401 when Authorization header is missing', async () => {
    const res = await request(app).post('/api/businesses/biz1/orders/ord1/approve');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth token' });
  });

  test('401 when token verification fails', async () => {
    mockAuth.verifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await request(app)
      .post('/api/businesses/biz1/orders/ord1/approve')
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid auth token' });
  });

  test('403 when owner is not linked to businessId', async () => {
    ownerRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessId: 'biz_other' }),
      }),
    });
    const res = await request(app)
      .post('/api/businesses/biz1/orders/ord1/approve')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not authorized for this business' });
  });

  test('200 when owner owns businessId', async () => {
    const res = await request(app)
      .post('/api/businesses/biz1/orders/ord1/approve')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('admin bypasses business ownership check', async () => {
    adminRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true }),
    });
    ownerRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    const res = await request(app)
      .post('/api/businesses/biz_other/orders/ord1/approve')
      .set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
  });

  test('401 on reject without Authorization (not only approve)', async () => {
    const res = await request(app).post('/api/businesses/biz1/orders/ord1/reject');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth token' });
  });

  test('200 on reject when owner owns businessId', async () => {
    const res = await request(app)
      .post('/api/businesses/biz1/orders/ord1/reject')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('auth applies on bare /businesses mount (no /api prefix)', async () => {
    const res = await request(app)
      .post('/businesses/biz1/orders/ord1/cancel')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('401 on bare /businesses mount without token', async () => {
    const res = await request(app).post('/businesses/biz1/orders/ord1/cancel');
    expect(res.status).toBe(401);
  });

  test('200 when businessId is in owner businessIds array', async () => {
    ownerRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a', 'biz1', 'biz_b'] }),
      }),
    });
    const res = await request(app)
      .post('/api/businesses/biz1/orders/ord1/approve')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
  });
});
