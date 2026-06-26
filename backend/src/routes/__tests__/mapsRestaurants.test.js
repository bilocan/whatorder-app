jest.mock('../../lib/firebase', () => ({ db: { collection: jest.fn() } }));
jest.mock('../../lib/collections', () => ({ businessRef: jest.fn() }));
jest.mock('../../lib/distance', () => ({
  sortByDistance: jest.fn(async (businesses) => businesses.map((b, i) => ({
    ...b,
    distanceKm: i === 0 ? 0.5 : 2.1,
    durationMin: i === 0 ? 3 : 8,
  }))),
}));

const request = require('supertest');
const app = require('../../index');
const { businessRef } = require('../../lib/collections');
const { sortByDistance } = require('../../lib/distance');

describe('GET /api/maps/restaurants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 without ids', async () => {
    const res = await request(app).get('/api/maps/restaurants');
    expect(res.status).toBe(400);
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
      { id: 'biz_a', name: 'Near', lat: 48.2, lng: 16.37, address: 'Wien', imageUrl: null, distanceKm: null, durationMin: null },
      { id: 'biz_b', name: 'Far', lat: 41, lng: 28.97, address: 'Wien', imageUrl: null, distanceKm: null, durationMin: null },
    ]);
    expect(sortByDistance).not.toHaveBeenCalled();
  });

  test('returns resolved imageUrl when present', async () => {
    businessRef.mockImplementation((id) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        id,
        data: () => ({
          name: 'Near',
          lat: 48.2,
          lng: 16.37,
          address: 'Wien',
          imageUrl: 'gs://my-bucket/businesses/biz_a/cover.jpg',
        }),
      }),
    }));

    const res = await request(app).get('/api/maps/restaurants').query({ ids: 'biz_a' });

    expect(res.status).toBe(200);
    expect(res.body.restaurants[0].imageUrl).toBe(
      'https://firebasestorage.googleapis.com/v0/b/my-bucket/o/businesses%2Fbiz_a%2Fcover.jpg?alt=media',
    );
  });

  test('returns distance when clat/clng provided', async () => {
    businessRef.mockImplementation((id) => ({
      get: jest.fn().mockResolvedValue({
        exists: true,
        id,
        data: () => ({
          name: 'Near',
          lat: 48.2,
          lng: 16.37,
          address: 'Wien',
        }),
      }),
    }));

    const res = await request(app)
      .get('/api/maps/restaurants')
      .query({ ids: 'biz_a', clat: '48.198', clng: '16.373' });

    expect(res.status).toBe(200);
    expect(sortByDistance).toHaveBeenCalled();
    expect(res.body.restaurants[0]).toMatchObject({
      id: 'biz_a',
      distanceKm: 0.5,
      durationMin: 3,
    });
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
