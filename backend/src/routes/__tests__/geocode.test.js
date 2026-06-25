jest.mock('../../lib/firebase', () => ({
  admin: { auth: jest.fn() },
}));
jest.mock('../../lib/collections', () => ({
  adminRef: jest.fn(),
  ownerRef: jest.fn(),
}));
jest.mock('../../lib/geocode', () => ({
  forwardGeocode: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');
const { adminRef, ownerRef } = require('../../lib/collections');
const { forwardGeocode } = require('../../lib/geocode');

let mockAuth;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { verifyIdToken: jest.fn().mockResolvedValue({ uid: 'owner-uid' }) };
  admin.auth.mockReturnValue(mockAuth);
  adminRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
  ownerRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: true }) });
});

describe('POST /api/geocode', () => {
  test('401 without auth token', async () => {
    const res = await request(app).post('/api/geocode').send({ address: 'Wien' });
    expect(res.status).toBe(401);
  });

  test('403 when user is neither owner nor admin', async () => {
    ownerRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    adminRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    const res = await request(app)
      .post('/api/geocode')
      .set('Authorization', 'Bearer valid-token')
      .send({ address: 'Wien' });

    expect(res.status).toBe(403);
  });

  test('returns lat/lng for valid address', async () => {
    forwardGeocode.mockResolvedValue({ lat: 48.2, lng: 16.36 });

    const res = await request(app)
      .post('/api/geocode')
      .set('Authorization', 'Bearer valid-token')
      .send({ address: 'Mariahilfer Str. 10, Wien' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lat: 48.2, lng: 16.36 });
    expect(forwardGeocode).toHaveBeenCalledWith('Mariahilfer Str. 10, Wien');
  });

  test('404 when address not found', async () => {
    forwardGeocode.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/geocode')
      .set('Authorization', 'Bearer valid-token')
      .send({ address: 'nowhere' });

    expect(res.status).toBe(404);
  });

  test('400 when address missing', async () => {
    const res = await request(app)
      .post('/api/geocode')
      .set('Authorization', 'Bearer valid-token')
      .send({});

    expect(res.status).toBe(400);
  });
});
