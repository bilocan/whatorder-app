jest.mock('../../lib/firebase', () => ({ db: { collection: jest.fn() } }));
jest.mock('../../lib/collections', () => ({ businessRef: jest.fn() }));

const request = require('supertest');
const app = require('../../index');
const { db } = require('../../lib/firebase');
const { businessRef } = require('../../lib/collections');

describe('GET /api/maps/restaurants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns restaurants with coordinates', async () => {
    businessRef.mockImplementation((id) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        id,
        data: () => ({
          name: id === 'biz_a' ? 'Near' : 'Far',
          lat: id === 'biz_a' ? 48.2 : 41.0,
          lng: id === 'biz_a' ? 16.37 : 28.97,
          address: 'Wien',
        }),
      }),
    }));

    const res = await request(app).get('/api/maps/restaurants').query({ ids: 'biz_a,biz_b' });

    expect(res.status).toBe(200);
    expect(res.body.restaurants).toEqual([
      { id: 'biz_a', name: 'Near', lat: 48.2, lng: 16.37, address: 'Wien' },
      { id: 'biz_b', name: 'Far', lat: 41, lng: 28.97, address: 'Wien' },
    ]);
  });

  test('skips restaurants without coordinates', async () => {
    businessRef.mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        id: 'biz_x',
        data: () => ({ name: 'No pin', lat: null, lng: null }),
      }),
    }));

    const res = await request(app).get('/api/maps/restaurants').query({ ids: 'biz_x' });
    expect(res.body.restaurants).toEqual([]);
  });
});
