jest.mock('../../lib/firebase', () => ({
  db: {},
  admin: { auth: jest.fn() },
}));
jest.mock('../../lib/collections', () => ({
  adminRef: jest.fn(),
  ownerRef: jest.fn(),
}));
jest.mock('../../lib/payoutService', () => ({
  runPayoutBatch: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');
const { adminRef } = require('../../lib/collections');
const { runPayoutBatch } = require('../../lib/payoutService');

let mockAuth;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'admin-uid' }),
  };
  admin.auth.mockReturnValue(mockAuth);
  adminRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true }) });
  runPayoutBatch.mockResolvedValue({ dryRun: true, payouts: [] });
});

describe('POST /admin/payouts/run', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/admin/payouts/run').send({});
    expect(res.status).toBe(401);
  });

  test('200 for admin with dry run', async () => {
    const res = await request(app)
      .post('/admin/payouts/run')
      .set('Authorization', 'Bearer valid')
      .send({ dryRun: true });
    expect(res.status).toBe(200);
    expect(runPayoutBatch).toHaveBeenCalledWith({ dryRun: true });
  });
});
