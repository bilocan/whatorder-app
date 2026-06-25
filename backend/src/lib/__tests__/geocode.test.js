const { reverseGeocode, forwardGeocode } = require('../geocode');

jest.mock('../googleMaps', () => ({
  isConfigured: jest.fn(),
  geocodeForward: jest.fn(),
  geocodeReverse: jest.fn(),
}));

const googleMaps = require('../googleMaps');

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
  googleMaps.isConfigured.mockReturnValue(false);
});

describe('reverseGeocode', () => {
  test('returns display_name on successful Nominatim response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ display_name: 'Mariahilfer Str. 10, 1060 Wien, Austria' }),
    });

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBe('Mariahilfer Str. 10, 1060 Wien, Austria');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('WhatOrder') }) }),
    );
  });

  test('prefers Google when configured', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.geocodeReverse.mockResolvedValue('Google Formatted Address');

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBe('Google Formatted Address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('falls back to Nominatim when Google returns null', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.geocodeReverse.mockResolvedValue(null);
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ display_name: 'OSM fallback' }),
    });

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBe('OSM fallback');
  });

  test('returns null when response is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false });

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBeNull();
  });
});

describe('forwardGeocode', () => {
  test('returns coords from Nominatim when Google not configured', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([{ lat: '48.2093', lon: '16.3621' }]),
    });

    const result = await forwardGeocode('Margaretenstrasse 42, Wien');

    expect(result).toEqual({ lat: 48.2093, lng: 16.3621 });
  });

  test('prefers Google when configured', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.geocodeForward.mockResolvedValue({ lat: 48.2, lng: 16.36 });

    const result = await forwardGeocode('Some address');

    expect(result).toEqual({ lat: 48.2, lng: 16.36 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns null for empty address', async () => {
    expect(await forwardGeocode('')).toBeNull();
    expect(await forwardGeocode('   ')).toBeNull();
  });
});
