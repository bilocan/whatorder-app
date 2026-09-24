jest.mock('../../lib/firebase', () => ({
  admin: { auth: jest.fn() },
}));

const request = require('supertest');
const app = require('../../index');
const { admin } = require('../../lib/firebase');

const createCustomToken = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WALLBOARD_TOKEN = 'office-secret';
  createCustomToken.mockResolvedValue('custom-token');
  admin.auth.mockReturnValue({ createCustomToken });
});

describe('POST /api/wallboard/session', () => {
  test('401 without a bearer token', async () => {
    const res = await request(app).post('/api/wallboard/session');
    expect(res.status).toBe(401);
    expect(createCustomToken).not.toHaveBeenCalled();
  });

  test('401 when the secret is wrong', async () => {
    const res = await request(app).post('/api/wallboard/session').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
  });

  test('401 when the secret is a different length', async () => {
    const res = await request(app).post('/api/wallboard/session').set('Authorization', 'Bearer short');
    expect(res.status).toBe(401);
  });

  test('401 when WALLBOARD_TOKEN is unset', async () => {
    delete process.env.WALLBOARD_TOKEN;
    const res = await request(app).post('/api/wallboard/session').set('Authorization', 'Bearer office-secret');
    expect(res.status).toBe(401);
  });

  test('200 and a custom token when the secret matches', async () => {
    const res = await request(app).post('/api/wallboard/session').set('Authorization', 'Bearer office-secret');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'custom-token' });
    expect(createCustomToken).toHaveBeenCalledWith('wallboard', { wallboard: true });
  });

  test('500 when createCustomToken throws', async () => {
    createCustomToken.mockRejectedValueOnce(new Error('auth down'));
    const res = await request(app).post('/api/wallboard/session').set('Authorization', 'Bearer office-secret');
    expect(res.status).toBe(500);
  });
});
