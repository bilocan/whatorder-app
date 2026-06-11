const { reverseGeocode } = require('../geocode');

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = jest.fn();
});

describe('reverseGeocode', () => {
  test('returns display_name on successful response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ display_name: 'Mariahilfer Str. 10, 1060 Wien, Austria' }),
    });

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBe('Mariahilfer Str. 10, 1060 Wien, Austria');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('lat=48.1975'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.stringContaining('WhatOrder') }) }),
    );
  });

  test('returns null when response is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false });

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBeNull();
  });

  test('returns null when response has no display_name', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ error: 'Unable to geocode' }),
    });

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBeNull();
  });

  test('returns null on timeout (AbortError)', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    global.fetch.mockRejectedValue(err);

    const result = await reverseGeocode(48.1975, 16.3599);

    expect(result).toBeNull();
  });

  test('includes both lat and lon in the request URL', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ display_name: 'Some Place' }),
    });

    await reverseGeocode(51.5074, -0.1278);

    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('lat=51.5074');
    expect(url).toContain('lon=-0.1278');
  });
});
