const googleMaps = require('../googleMaps');
const distanceCache = require('../distanceCache');

jest.mock('../googleMaps', () => {
  const actual = jest.requireActual('../googleMaps');
  return {
    ...actual,
    isConfigured: jest.fn(),
    fetchDrivingDistances: jest.fn(),
  };
});

const { sortByDistance } = require('../distance');

describe('sortByDistance with Google Maps', () => {
  const CUSTOMER_LAT = 48.2093;
  const CUSTOMER_LNG = 16.3621;

  beforeEach(() => {
    distanceCache.clear();
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.fetchDrivingDistances.mockReset();
  });

  test('uses driving distance and duration when API succeeds', async () => {
    googleMaps.fetchDrivingDistances.mockResolvedValue([
      { distanceKm: 2.1, durationMin: 7 },
      { distanceKm: 0.8, durationMin: 3 },
    ]);

    const businesses = [
      { id: 'a', lat: 48.22, lng: 16.37 },
      { id: 'b', lat: 48.21, lng: 16.36 },
    ];

    const result = await sortByDistance(businesses, CUSTOMER_LAT, CUSTOMER_LNG);

    expect(result.map(b => b.id)).toEqual(['b', 'a']);
    expect(result[0]).toMatchObject({ distanceKm: 0.8, durationMin: 3 });
    expect(result[1]).toMatchObject({ distanceKm: 2.1, durationMin: 7 });
  });

  test('falls back to Haversine when API returns null', async () => {
    googleMaps.fetchDrivingDistances.mockResolvedValue(null);

    const businesses = [
      { id: 'far', lat: 52.52, lng: 13.405 },
      { id: 'close', lat: 48.2183, lng: 16.3621 },
    ];

    const result = await sortByDistance(businesses, CUSTOMER_LAT, CUSTOMER_LNG);

    expect(result.map(b => b.id)).toEqual(['close', 'far']);
    expect(result[0].durationMin).toBeNull();
  });

  test('reads from cache on second call for same origin + business', async () => {
    googleMaps.fetchDrivingDistances.mockResolvedValue([
      { distanceKm: 1.5, durationMin: 5 },
    ]);

    const businesses = [{ id: 'a', lat: 48.22, lng: 16.37 }];
    await sortByDistance(businesses, CUSTOMER_LAT, CUSTOMER_LNG);
    await sortByDistance(businesses, CUSTOMER_LAT, CUSTOMER_LNG);

    expect(googleMaps.fetchDrivingDistances).toHaveBeenCalledTimes(1);
  });
});
