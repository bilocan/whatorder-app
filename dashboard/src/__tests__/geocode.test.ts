import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    },
  },
}));

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
  it('returns lat/lng from backend API', async () => {
    mockFetch(200, { lat: 48.2093, lng: 16.3621 });

    const result = await geocodeAddress('Margaretenstrasse 42, Wien');

    expect(result).toEqual({ lat: 48.2093, lng: 16.3621 });
  });

  it('returns null when backend returns 404', async () => {
    mockFetch(404, { error: 'Address not found' });

    const result = await geocodeAddress('xkcd nowhere 99999');

    expect(result).toBeNull();
  });

  it('throws when backend returns a non-ok status', async () => {
    mockFetch(500, { error: 'Geocode failed' });

    await expect(geocodeAddress('any address')).rejects.toThrow('Geocode error: 500');
  });

  it('calls backend with auth token and address', async () => {
    mockFetch(200, { lat: 48.0, lng: 16.0 });

    await geocodeAddress('Döner Palace, Wien');

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/geocode');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toEqual({ address: 'Döner Palace, Wien' });
  });
});
