jest.mock('../../lib/googleMaps', () => ({
  getMapsJsApiKey: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { getMapsJsApiKey } = require('../../lib/googleMaps');

describe('GET /api/maps/config', () => {
  const originalBackendUrl = process.env.BACKEND_URL;

  afterEach(() => {
    if (originalBackendUrl) process.env.BACKEND_URL = originalBackendUrl;
    else delete process.env.BACKEND_URL;
    jest.clearAllMocks();
  });

  test('returns maps JS key and api base', async () => {
    getMapsJsApiKey.mockReturnValue('test-js-key');
    process.env.BACKEND_URL = 'https://api.example.com/';

    const res = await request(app).get('/api/maps/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      apiBase: 'https://api.example.com',
      mapsApiKey: 'test-js-key',
    });
  });

  test('returns 503 when key is not configured', async () => {
    getMapsJsApiKey.mockReturnValue(null);

    const res = await request(app).get('/api/maps/config');

    expect(res.status).toBe(503);
  });
});
