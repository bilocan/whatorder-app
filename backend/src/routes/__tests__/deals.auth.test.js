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
jest.mock('../../lib/dealService', () => ({
  parseDealKindParam: jest.fn(),
  validateDealBody: jest.fn(),
  listDeals: jest.fn().mockResolvedValue({}),
  upsertDeal: jest.fn(),
  setDealActive: jest.fn(),
  endDeal: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');
const { ownerRef, adminRef } = require('../../lib/collections');
const { listDeals } = require('../../lib/dealService');

let mockAuth;

beforeEach(() => {
  jest.clearAllMocks();
  listDeals.mockResolvedValue({});
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

describe('deal route auth (requireOwnerOfBusiness)', () => {
  test('401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/businesses/biz1/deals');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth token' });
  });

  test('403 when owner of biz1 PUTs first-order on another business', async () => {
    const res = await request(app)
      .put('/api/businesses/biz_other/deals/first-order')
      .set('Authorization', 'Bearer valid-token')
      .send({ discountType: 'percent', discountValue: 10 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not authorized for this business' });
  });

  test('GET own business deals is not 403', async () => {
    const res = await request(app)
      .get('/api/businesses/biz1/deals')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});
