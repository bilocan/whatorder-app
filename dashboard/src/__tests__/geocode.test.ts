import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodeAddress } from '../lib/geocode';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geocodeAddress', () => {
  it('returns lat/lng for a valid address', async () => {
    mockFetch(200, [{ lat: '48.2093', lon: '16.3621' }]);

    const result = await geocodeAddress('Margaretenstrasse 42, Wien');

    expect(result).toEqual({ lat: 48.2093, lng: 16.3621 });
  });

  it('returns null when Nominatim finds no results', async () => {
    mockFetch(200, []);

    const result = await geocodeAddress('xkcd nowhere 99999');

    expect(result).toBeNull();
  });

  it('throws when Nominatim returns a non-ok status', async () => {
    mockFetch(429, {});

    await expect(geocodeAddress('any address')).rejects.toThrow('Nominatim error: 429');
  });

  it('calls Nominatim with the address URL-encoded', async () => {
    mockFetch(200, [{ lat: '48.0', lon: '16.0' }]);

    await geocodeAddress('Döner Palace, Wien');

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain('nominatim.openstreetmap.org/search');
    expect(calledUrl).toContain(encodeURIComponent('Döner Palace, Wien'));
  });

  it('sends a User-Agent header', async () => {
    mockFetch(200, [{ lat: '48.0', lon: '16.0' }]);

    await geocodeAddress('Some Street 1');

    const calledInit = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(calledInit?.headers?.['User-Agent']).toMatch(/WhatOrder/);
  });

  it('parses lat/lng as numbers, not strings', async () => {
    mockFetch(200, [{ lat: '48.2093000', lon: '16.3621000' }]);

    const result = await geocodeAddress('any');

    expect(typeof result?.lat).toBe('number');
    expect(typeof result?.lng).toBe('number');
  });
});
