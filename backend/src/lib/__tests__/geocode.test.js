jest.mock('../googleMaps', () => ({
  isConfigured: jest.fn(),
  geocodeForward: jest.fn(),
  geocodeReverse: jest.fn(),
  validateAddress: jest.fn(),
}));

const googleMaps = require('../googleMaps');
const { reverseGeocode, forwardGeocode, validateDeliveryAddress } = require('../geocode');

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
      json: jest.fn().mockResolvedValue([{
        lat: '48.2093',
        lon: '16.3621',
        display_name: 'Margaretenstrasse 42, Wien',
        address: { road: 'Margaretenstraße', house_number: '42', postcode: '1050', city: 'Wien' },
      }]),
    });

    const result = await forwardGeocode('Margaretenstrasse 42, Wien');

    expect(result).toEqual({
      lat: 48.2093,
      lng: 16.3621,
      formattedAddress: 'Margaretenstraße 42, 1050 Wien',
    });
  });

  test('prefers Google when configured', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.geocodeForward.mockResolvedValue({ lat: 48.2, lng: 16.36, formattedAddress: 'Some address' });

    const result = await forwardGeocode('Some address');

    expect(result).toEqual({ lat: 48.2, lng: 16.36, formattedAddress: 'Some address' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns null for empty address', async () => {
    expect(await forwardGeocode('')).toBeNull();
    expect(await forwardGeocode('   ')).toBeNull();
  });
});

describe('validateDeliveryAddress', () => {
  test('prefers Address Validation when available', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.validateAddress.mockResolvedValue({
      formattedAddress: 'Lavaterstraße 3, 1050 Wien, Austria',
      lat: 48.19,
      lng: 16.35,
      possibleNextAction: 'CONFIRM',
      hasReplacedComponents: true,
      hasInferredComponents: false,
    });

    const result = await validateDeliveryAddress('lavaterstrse 3 wien');

    expect(result.formattedAddress).toBe('Lavaterstraße 3, 1050 Wien, Austria');
    expect(googleMaps.geocodeForward).not.toHaveBeenCalled();
  });

  test('falls back to Geocoding formatted address when validation missing', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.validateAddress.mockResolvedValue(null);
    googleMaps.geocodeForward.mockResolvedValue({
      lat: 48.19,
      lng: 16.35,
      formattedAddress: 'Lavaterstraße 3, 1050 Wien, Austria',
    });

    const result = await validateDeliveryAddress('lavaterstrse 3 wien');

    expect(result).toEqual(expect.objectContaining({
      formattedAddress: 'Lavaterstraße 3, 1050 Wien, Austria',
      lat: 48.19,
      lng: 16.35,
    }));
  });

  test('falls back to Geocoding when Address Validation returns FIX echo', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.validateAddress.mockResolvedValue({
      formattedAddress: 'lavatastrasse 3',
      lat: 1,
      lng: 2,
      possibleNextAction: 'FIX',
      hasReplacedComponents: false,
      hasInferredComponents: false,
    });
    googleMaps.geocodeForward.mockResolvedValue({
      lat: 48.19,
      lng: 16.35,
      formattedAddress: 'Lavaterstraße 3, 1050 Wien, Austria',
    });

    const result = await validateDeliveryAddress('lavatastrasse 3');

    expect(result.formattedAddress).toBe('Lavaterstraße 3, 1050 Wien, Austria');
    expect(googleMaps.geocodeForward).toHaveBeenCalled();
  });

  test('uses Address Validation FIX suggestion when it differs from input', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.validateAddress.mockResolvedValue({
      formattedAddress: 'Lavaterstraße 3, 1050 Wien, Austria',
      lat: 48.19,
      lng: 16.35,
      possibleNextAction: 'FIX',
      hasReplacedComponents: true,
      hasInferredComponents: false,
    });

    const result = await validateDeliveryAddress('lavatastrasse 3');

    expect(result.formattedAddress).toBe('Lavaterstraße 3, 1050 Wien, Austria');
    expect(googleMaps.geocodeForward).not.toHaveBeenCalled();
  });

  test('falls back to Geocoding when Address Validation leaves postal_code unconfirmed', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.validateAddress.mockResolvedValue({
      formattedAddress: 'Lavaterstraße 3, 1110 Wien, Österreich',
      lat: 48.19,
      lng: 16.35,
      possibleNextAction: 'CONFIRM',
      hasReplacedComponents: false,
      hasInferredComponents: true,
      hasUnconfirmedComponents: true,
      unconfirmedComponentTypes: ['postal_code'],
    });
    googleMaps.geocodeForward.mockResolvedValue({
      lat: 48.22,
      lng: 16.40,
      formattedAddress: 'Lavaterstraße 3, 1220 Wien, Österreich',
    });

    const result = await validateDeliveryAddress('Lavetersttasse 3 1110');

    expect(result.formattedAddress).toBe('Lavaterstraße 3, 1220 Wien, Österreich');
    expect(googleMaps.geocodeForward).toHaveBeenCalled();
  });

  test('falls back to Nominatim when Google unavailable', async () => {
    googleMaps.isConfigured.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([{
        lat: '48.19',
        lon: '16.35',
        address: { road: 'Lavaterstraße', house_number: '3', postcode: '1050', city: 'Wien' },
      }]),
    });

    const result = await validateDeliveryAddress('lavaterstrse 3 wien');

    expect(result.formattedAddress).toBe('Lavaterstraße 3, 1050 Wien');
  });

  test('rejects city-only Google geocode (not deliverable)', async () => {
    googleMaps.isConfigured.mockReturnValue(true);
    googleMaps.validateAddress.mockResolvedValue(null);
    googleMaps.geocodeForward.mockResolvedValue({
      lat: 48.2082,
      lng: 16.3738,
      formattedAddress: 'Wien, Austria',
    });
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([]),
    });

    const result = await validateDeliveryAddress('panikken gasse wien');

    expect(result).toBeNull();
  });

  test('rejects street without house number from Nominatim', async () => {
    googleMaps.isConfigured.mockReturnValue(false);
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([{
        lat: '48.19',
        lon: '16.35',
        address: { road: 'Panikengasse', postcode: '1150', city: 'Wien' },
      }]),
    });

    const result = await validateDeliveryAddress('panikken gasse wien');

    expect(result).toBeNull();
  });
});
