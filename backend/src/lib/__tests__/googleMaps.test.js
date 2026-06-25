const { isConfigured, fetchDrivingDistances, geocodeForward, geocodeReverse } = require('../googleMaps');

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
  delete process.env.GOOGLE_MAPS_API_KEY;
});

describe('googleMaps', () => {
  test('isConfigured returns false without API key', () => {
    expect(isConfigured()).toBe(false);
  });

  test('isConfigured returns true with API key', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    expect(isConfigured()).toBe(true);
  });

  test('fetchDrivingDistances returns null without API key', async () => {
    const result = await fetchDrivingDistances(48.2, 16.36, [{ lat: 48.21, lng: 16.37 }]);
    expect(result).toBeNull();
  });

  test('fetchDrivingDistances parses Distance Matrix response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'OK',
        rows: [{
          elements: [
            { status: 'OK', distance: { value: 1800, text: '1.8 km' }, duration: { value: 360, text: '6 mins' } },
          ],
        }],
      }),
    });

    const result = await fetchDrivingDistances(48.2, 16.36, [{ lat: 48.21, lng: 16.37 }]);

    expect(result).toEqual([{ distanceKm: 1.8, durationMin: 6 }]);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('distancematrix'),
      expect.any(Object),
    );
  });

  test('geocodeForward returns lat/lng from Geocoding API', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'OK',
        results: [{ geometry: { location: { lat: 48.2093, lng: 16.3621 } } }],
      }),
    });

    const result = await geocodeForward('Wien');

    expect(result).toEqual({ lat: 48.2093, lng: 16.3621 });
  });

  test('geocodeReverse returns formatted address', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 'OK',
        results: [{ formatted_address: '1060 Wien, Austria' }],
      }),
    });

    const result = await geocodeReverse(48.2, 16.36);

    expect(result).toBe('1060 Wien, Austria');
  });
});
