const {
  buildRestaurantsStaticMapUrl,
  buildRestaurantsMapProxyUrl,
  buildRestaurantsBrowseMapUrl,
  buildPublicRestaurantMapUrl,
  parsePinsParam,
  getPublicBackendUrl,
} = require('../mapsUrl');

describe('buildRestaurantsStaticMapUrl', () => {
  const customer = { lat: 48.198, lng: 16.373 };
  const restaurants = [
    { id: 'a', name: 'Near', lat: 48.1974, lng: 16.3734 },
    { id: 'b', name: 'Far', lat: 48.2093, lng: 16.3621 },
  ];

  test('returns null without API key', () => {
    expect(buildRestaurantsStaticMapUrl(customer.lat, customer.lng, restaurants, null)).toBeNull();
  });

  test('accepts string coordinates from Firestore', () => {
    const url = buildRestaurantsStaticMapUrl(customer.lat, customer.lng, [
      { id: 'a', lat: '48.1974', lng: '16.3734' },
    ], 'test-key');
    expect(url).toContain('markers=color:red%7Clabel:1%7C48.1974,16.3734');
  });

  test('builds static map with numbered markers and visible bounds', () => {
    const url = buildRestaurantsStaticMapUrl(customer.lat, customer.lng, restaurants, 'test-key');
    expect(url).toMatch(/^https:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?/);
    expect(url).toContain('markers=color:blue%7Clabel:U%7C48.198,16.373');
    expect(url).toContain('markers=color:red%7Clabel:1%7C48.1974,16.3734');
    expect(url).toContain('markers=color:red%7Clabel:2%7C48.2093,16.3621');
    expect(url).toContain('visible=');
    expect(url).toContain('key=test-key');
    expect(url).not.toContain('travelmode');
  });
});

describe('buildRestaurantsMapProxyUrl', () => {
  test('builds backend proxy URL for WhatsApp image fetch', () => {
    const url = buildRestaurantsMapProxyUrl(48.198, 16.373, [
      { lat: 48.1974, lng: 16.3734 },
    ], 'https://example.ngrok-free.dev');
    expect(url).toBe(
      'https://example.ngrok-free.dev/api/maps/restaurants-preview?clat=48.198&clng=16.373&pins=48.1974%2C16.3734',
    );
  });
});

describe('getPublicBackendUrl', () => {
  const originalBackend = process.env.BACKEND_URL;
  const originalNgrok = process.env.NGROK_DOMAIN;

  afterEach(() => {
    if (originalBackend) process.env.BACKEND_URL = originalBackend;
    else delete process.env.BACKEND_URL;
    if (originalNgrok) process.env.NGROK_DOMAIN = originalNgrok;
    else delete process.env.NGROK_DOMAIN;
  });

  test('prefers non-localhost BACKEND_URL', () => {
    process.env.BACKEND_URL = 'https://api.example.com/';
    delete process.env.NGROK_DOMAIN;
    expect(getPublicBackendUrl()).toBe('https://api.example.com');
  });

  test('falls back to NGROK_DOMAIN when BACKEND_URL is localhost', () => {
    process.env.BACKEND_URL = 'http://localhost:3000';
    process.env.NGROK_DOMAIN = 'tunnel.ngrok-free.dev';
    expect(getPublicBackendUrl()).toBe('https://tunnel.ngrok-free.dev');
  });
});

describe('parsePinsParam', () => {
  test('parses pipe-separated coordinate pairs', () => {
    expect(parsePinsParam('48.1,16.1|48.2,16.2')).toEqual([
      { id: 'p0', lat: 48.1, lng: 16.1 },
      { id: 'p1', lat: 48.2, lng: 16.2 },
    ]);
  });
});

describe('buildPublicRestaurantMapUrl', () => {
  test('builds dashboard map URL with customer location and ids', () => {
    const url = buildPublicRestaurantMapUrl(48.198, 16.373, ['biz_a', 'biz_b'], 'http://localhost:5173');
    expect(url).toBe('http://localhost:5173/map?clat=48.198&clng=16.373&ids=biz_a%2Cbiz_b');
  });
});

describe('buildRestaurantsBrowseMapUrl', () => {
  test('opens browse map without directions', () => {
    const url = buildRestaurantsBrowseMapUrl(48.198, 16.373, [
      { id: 'a', lat: 48.1974, lng: 16.3734 },
    ]);
    expect(url).toContain('map_action=map');
    expect(url).not.toContain('/dir/');
  });
});
