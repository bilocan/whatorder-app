const { haversineKm, sortByDistance, filterWithinDistanceKm, getMaxRestaurantDistanceKm } = require('../distance');

describe('haversineKm', () => {
  test('same point returns 0', () => {
    expect(haversineKm(48.2093, 16.3621, 48.2093, 16.3621)).toBeCloseTo(0, 5);
  });

  test('Vienna to Berlin is approximately 523 km', () => {
    const dist = haversineKm(48.2093, 16.3621, 52.5200, 13.4050);
    expect(dist).toBeGreaterThan(520);
    expect(dist).toBeLessThan(530);
  });

  test('short distance is reasonable (1 km grid step ~0.009 deg lat)', () => {
    const dist = haversineKm(48.2093, 16.3621, 48.2183, 16.3621);
    expect(dist).toBeGreaterThan(0.9);
    expect(dist).toBeLessThan(1.1);
  });
});

describe('sortByDistance', () => {
  const BUSINESSES = [
    { id: 'far',   lat: 52.5200, lng: 13.4050 },
    { id: 'close', lat: 48.2183, lng: 16.3621 },
    { id: 'mid',   lat: 48.3000, lng: 16.3621 },
  ];
  const CUSTOMER_LAT = 48.2093;
  const CUSTOMER_LNG = 16.3621;

  const originalKey = process.env.GOOGLE_MAPS_API_KEY;

  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterAll(() => {
    if (originalKey) process.env.GOOGLE_MAPS_API_KEY = originalKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  test('sorts nearest first (Haversine fallback without API key)', async () => {
    const result = await sortByDistance(BUSINESSES, CUSTOMER_LAT, CUSTOMER_LNG);
    expect(result.map(b => b.id)).toEqual(['close', 'mid', 'far']);
  });

  test('attaches distanceKm to each business with coords', async () => {
    const result = await sortByDistance(BUSINESSES, CUSTOMER_LAT, CUSTOMER_LNG);
    result.forEach(b => expect(typeof b.distanceKm).toBe('number'));
  });

  test('businesses without coords get distanceKm null and go to end', async () => {
    const mixed = [
      { id: 'no_coords' },
      { id: 'close', lat: 48.2183, lng: 16.3621 },
    ];
    const result = await sortByDistance(mixed, CUSTOMER_LAT, CUSTOMER_LNG);
    expect(result[0].id).toBe('close');
    expect(result[1].id).toBe('no_coords');
    expect(result[1].distanceKm).toBeNull();
  });

  test('businesses with null lat/lng get distanceKm null and go to end', async () => {
    const mixed = [
      { id: 'null_coords', lat: null, lng: null },
      { id: 'close', lat: 48.2183, lng: 16.3621 },
    ];
    const result = await sortByDistance(mixed, CUSTOMER_LAT, CUSTOMER_LNG);
    expect(result[0].id).toBe('close');
    expect(result[1].distanceKm).toBeNull();
  });

  test('all without coords preserves original order', async () => {
    const noCoords = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = await sortByDistance(noCoords, CUSTOMER_LAT, CUSTOMER_LNG);
    expect(result.map(b => b.id)).toEqual(['a', 'b', 'c']);
  });

  test('does not mutate original array', async () => {
    const orig = [...BUSINESSES];
    await sortByDistance(BUSINESSES, CUSTOMER_LAT, CUSTOMER_LNG);
    expect(BUSINESSES).toEqual(orig);
  });
});

describe('filterWithinDistanceKm', () => {
  test('keeps only businesses within max km', () => {
    const businesses = [
      { id: 'near', distanceKm: 3.2 },
      { id: 'edge', distanceKm: 20 },
      { id: 'far', distanceKm: 1200 },
      { id: 'unknown', distanceKm: null },
    ];
    expect(filterWithinDistanceKm(businesses, 20).map(b => b.id)).toEqual(['near', 'edge']);
  });

  test('defaults to 20 km from env helper', () => {
    const businesses = [{ id: 'ok', distanceKm: 19.9 }, { id: 'no', distanceKm: 20.1 }];
    expect(filterWithinDistanceKm(businesses).map(b => b.id)).toEqual(['ok']);
    expect(getMaxRestaurantDistanceKm()).toBe(20);
  });
});
