jest.mock('../../lib/firebase', () => ({
  db: {},
  admin: {
    auth: jest.fn(),
    firestore: {
      FieldValue: { arrayUnion: jest.fn((...args) => ({ _arrayUnion: args })) },
    },
  },
}));
jest.mock('../../lib/collections', () => ({
  adminRef: jest.fn(),
  ownerRef: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');
const { adminRef, ownerRef } = require('../../lib/collections');

let mockAuth;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = {
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'admin-uid' }),
    getUserByPhoneNumber: jest.fn(),
    createUser: jest.fn(),
  };
  admin.auth.mockReturnValue(mockAuth);
  adminRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true }) });
  ownerRef.mockReturnValue({
    set: jest.fn().mockResolvedValue(),
    delete: jest.fn().mockResolvedValue(),
  });
});

// ── requireAdmin middleware ──────────────────────────────────────────────────

describe('requireAdmin middleware', () => {
  test('401 when Authorization header is missing', async () => {
    const res = await request(app).post('/admin/owners').send({ phone: '+431234', businessId: 'biz1' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth token' });
  });

  test('401 when token verification fails', async () => {
    mockAuth.verifyIdToken.mockRejectedValue(new Error('bad token'));
    const res = await request(app)
      .post('/admin/owners')
      .set('Authorization', 'Bearer bad-token')
      .send({ phone: '+431234', businessId: 'biz1' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid auth token' });
  });

  test('403 when uid is not in admins collection', async () => {
    adminRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const res = await request(app)
      .post('/admin/owners')
      .set('Authorization', 'Bearer valid-token')
      .send({ phone: '+431234', businessId: 'biz1' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not an admin' });
  });
});

// ── POST /admin/owners ───────────────────────────────────────────────────────

describe('POST /admin/owners', () => {
  const authHeader = { Authorization: 'Bearer valid-token' };

  test('400 when phone is missing', async () => {
    const res = await request(app).post('/admin/owners').set(authHeader).send({ businessId: 'biz1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'phone and businessId are required' });
  });

  test('400 when businessId is missing', async () => {
    const res = await request(app).post('/admin/owners').set(authHeader).send({ phone: '+431234' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'phone and businessId are required' });
  });

  test('200 when user already exists in Auth', async () => {
    mockAuth.getUserByPhoneNumber.mockResolvedValue({ uid: 'existing-uid' });
    const res = await request(app)
      .post('/admin/owners')
      .set(authHeader)
      .send({ phone: '+43 123 4', businessId: 'biz1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ uid: 'existing-uid', phone: '+431234' });
    expect(ownerRef).toHaveBeenCalledWith('existing-uid');
  });

  test('normalizePhone strips spaces/dashes and adds + prefix', async () => {
    mockAuth.getUserByPhoneNumber.mockResolvedValue({ uid: 'uid1' });
    const res = await request(app)
      .post('/admin/owners')
      .set(authHeader)
      .send({ phone: '43-12 34', businessId: 'biz1' });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+431234');
  });

  test('200 creates user when not found in Auth', async () => {
    const notFoundErr = Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
    mockAuth.getUserByPhoneNumber.mockRejectedValue(notFoundErr);
    mockAuth.createUser.mockResolvedValue({ uid: 'new-uid' });
    const res = await request(app)
      .post('/admin/owners')
      .set(authHeader)
      .send({ phone: '+431234', businessId: 'biz1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ uid: 'new-uid', phone: '+431234' });
    expect(mockAuth.createUser).toHaveBeenCalledWith({ phoneNumber: '+431234' });
  });

  test('500 when getUserByPhoneNumber fails with unexpected error', async () => {
    mockAuth.getUserByPhoneNumber.mockRejectedValue(new Error('some auth error'));
    const res = await request(app)
      .post('/admin/owners')
      .set(authHeader)
      .send({ phone: '+431234', businessId: 'biz1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Auth lookup failed' });
  });

  test('500 when createUser fails', async () => {
    const notFoundErr = Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
    mockAuth.getUserByPhoneNumber.mockRejectedValue(notFoundErr);
    mockAuth.createUser.mockRejectedValue(new Error('create failed'));
    const res = await request(app)
      .post('/admin/owners')
      .set(authHeader)
      .send({ phone: '+431234', businessId: 'biz1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create user' });
  });
});

// ── DELETE /admin/owners ─────────────────────────────────────────────────────

describe('DELETE /admin/owners', () => {
  const authHeader = { Authorization: 'Bearer valid-token' };

  test('400 when uid query param is missing', async () => {
    const res = await request(app).delete('/admin/owners').set(authHeader);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'uid query param required' });
  });

  test('200 deletes owner and returns ok', async () => {
    const res = await request(app).delete('/admin/owners').set(authHeader).query({ uid: 'some-uid' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(ownerRef).toHaveBeenCalledWith('some-uid');
  });
});
