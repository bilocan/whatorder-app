jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/googleMaps', () => ({
  getApiKey: jest.fn(() => 'test-maps-key'),
}));

const request = require('supertest');
const app = require('../../index');

describe('GET /api/maps/restaurants-preview', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('returns image bytes from Google Static Maps', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
    });

    const res = await request(app)
      .get('/api/maps/restaurants-preview')
      .query({ clat: 48.198, clng: 16.373, pins: '48.1974,16.3734' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('maps.googleapis.com/maps/api/staticmap'),
      expect.any(Object),
    );
  });

  test('returns 400 when pins missing', async () => {
    const res = await request(app)
      .get('/api/maps/restaurants-preview')
      .query({ clat: 48.198, clng: 16.373 });

    expect(res.status).toBe(400);
  });
});
