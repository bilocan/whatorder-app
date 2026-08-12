import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../lib/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('test-token'),
    },
  },
}));

import { fetchDeals, putDeal, pauseDeal, endDeal } from '../lib/dealsApi';
import type { DealsResponse } from '../lib/dealsApi';

const LIST: DealsResponse = {
  firstOrder: null,
  window: {
    dealId: 'w1',
    kind: 'window',
    discountType: 'percent',
    discountValue: 15,
    label: '15% Rabatt',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-31T23:59:59.000Z',
    active: true,
    updatedAt: '2026-08-13T12:00:00.000Z',
  },
  history: [],
};

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

describe('putDeal', () => {
  it('hits PUT /api/businesses/biz/deals/window with JSON body', async () => {
    mockFetch(200, LIST);
    const body = {
      discountType: 'percent',
      discountValue: 15,
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-08-31T23:59:59.000Z',
    };

    const result = await putDeal('biz', 'window', body);

    expect(result).toEqual(LIST);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/businesses/biz/deals/window');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it('throws the JSON error string on 403', async () => {
    mockFetch(403, { error: 'Not authorized for this business' });

    await expect(
      putDeal('biz', 'window', { discountType: 'percent', discountValue: 15 }),
    ).rejects.toThrow('Not authorized for this business');
  });
});

describe('fetchDeals', () => {
  it('GETs /api/businesses/biz/deals and returns the list payload', async () => {
    mockFetch(200, LIST);

    const result = await fetchDeals('biz');

    expect(result).toEqual(LIST);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/businesses/biz/deals');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
    });
  });
});

describe('pauseDeal', () => {
  it('POSTs /api/businesses/biz/deals/window/pause with active', async () => {
    mockFetch(200, { ...LIST, window: { ...LIST.window!, active: false } });

    const result = await pauseDeal('biz', 'window', false);

    expect(result.window?.active).toBe(false);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/businesses/biz/deals/window/pause');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ active: false });
  });
});

describe('endDeal', () => {
  it('POSTs /api/businesses/biz/deals/first-order/end', async () => {
    mockFetch(200, { firstOrder: null, window: null, history: [] });

    const result = await endDeal('biz', 'first-order');

    expect(result).toEqual({ firstOrder: null, window: null, history: [] });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/businesses/biz/deals/first-order/end');
    expect(init?.method).toBe('POST');
  });
});
