const {
  buildRestaurantsBrowseMapUrl,
  buildPublicRestaurantMapUrl,
  buildOpenMapCtaUrl,
} = require('../mapsUrl');

describe('buildPublicRestaurantMapUrl', () => {
  test('builds map URL with customer location, ids, and lang', () => {
    const url = buildPublicRestaurantMapUrl(48.198, 16.373, ['biz_a', 'biz_b'], 'https://whatorder.at', 'tr');
    expect(url).toBe('https://whatorder.at/map?clat=48.198&clng=16.373&ids=biz_a%2Cbiz_b&lang=tr');
  });

  test('omits unknown lang codes', () => {
    const url = buildPublicRestaurantMapUrl(48.198, 16.373, ['biz_a'], 'https://whatorder.at', 'fr');
    expect(url).not.toContain('lang=');
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

describe('buildOpenMapCtaUrl', () => {
  const customer = { lat: 48.198, lng: 16.373 };
  const restaurants = [
    { id: 'biz_a', name: 'Near', lat: 48.1974, lng: 16.3734 },
    { id: 'biz_b', name: 'Far', lat: 48.2093, lng: 16.3621 },
  ];
  const originalMapPublic = process.env.MAP_PUBLIC_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalMapPublic) process.env.MAP_PUBLIC_URL = originalMapPublic;
    else delete process.env.MAP_PUBLIC_URL;
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('uses localhost /map in non-production when MAP_PUBLIC_URL is unset', () => {
    delete process.env.MAP_PUBLIC_URL;
    process.env.NODE_ENV = 'development';
    const url = buildOpenMapCtaUrl(customer.lat, customer.lng, restaurants, ['biz_a', 'biz_b']);
    expect(url).toBe('http://localhost:3000/map?clat=48.198&clng=16.373&ids=biz_a%2Cbiz_b');
  });

  test('passes session lang in map URL', () => {
    delete process.env.MAP_PUBLIC_URL;
    process.env.NODE_ENV = 'production';
    const url = buildOpenMapCtaUrl(customer.lat, customer.lng, restaurants, ['biz_a', 'biz_b'], 'de');
    expect(url).toBe('https://whatorder.at/map?clat=48.198&clng=16.373&ids=biz_a%2Cbiz_b&lang=de');
  });

  test('prefers MAP_PUBLIC_URL when set', () => {
    process.env.MAP_PUBLIC_URL = 'https://app.example.com';
    process.env.NODE_ENV = 'production';
    const url = buildOpenMapCtaUrl(customer.lat, customer.lng, restaurants, ['biz_a', 'biz_b']);
    expect(url).toBe('https://app.example.com/map?clat=48.198&clng=16.373&ids=biz_a%2Cbiz_b');
  });
});
