const {
  resolveTypedDeliveryAddress,
  shouldConfirmDeliveryBuilding,
} = require('../resolveTypedDeliveryAddress');

jest.mock('../../lib/geocode', () => ({
  validateDeliveryAddress: jest.fn(),
}));

const { validateDeliveryAddress } = require('../../lib/geocode');

describe('shouldConfirmDeliveryBuilding', () => {
  test('skips confirm when PLZ present and nearly same', () => {
    expect(shouldConfirmDeliveryBuilding(
      'Lavaterstrasse 3, Top 4, 1220 Wien',
      'Lavaterstraße 3, Top 4, 1220 Wien',
    )).toBe(false);
  });

  test('requires confirm when PLZ missing', () => {
    expect(shouldConfirmDeliveryBuilding(
      'Lavaterstrasse 3 Wien',
      'Lavaterstraße 3, 1220 Wien',
    )).toBe(true);
  });

  test('requires confirm when label differs', () => {
    expect(shouldConfirmDeliveryBuilding(
      'Lavaterstrasse 3, 1110 Wien',
      'Lavaterstraße 3, 1220 Wien',
    )).toBe(true);
  });
});

describe('resolveTypedDeliveryAddress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns normalized building with unit hint from slash form', async () => {
    validateDeliveryAddress.mockResolvedValue({
      formattedAddress: 'Lavaterstraße 3, 1220 Wien',
      lat: 1,
      lng: 2,
    });

    const result = await resolveTypedDeliveryAddress('Lavaterstrasse 3/3/15 1220');
    expect(result).toEqual({
      ok: true,
      building: 'Lavaterstraße 3, Stiege 3, Top 15, 1220 Wien',
      lat: 1,
      lng: 2,
    });
  });

  test('strips Google PLZ-as-subpremise so confirm does not invent Top', async () => {
    validateDeliveryAddress.mockResolvedValue({
      formattedAddress: 'Hauptstraße 5/1290, 1140 Wien, Austria',
      lat: 48.2,
      lng: 16.3,
    });

    const result = await resolveTypedDeliveryAddress('Hauptstrasse 5, 1290 Wien');
    expect(result).toEqual({
      ok: true,
      building: 'Hauptstraße 5, 1140 Wien',
      lat: 48.2,
      lng: 16.3,
    });
    expect(shouldConfirmDeliveryBuilding(
      'Hauptstrasse 5, 1290 Wien',
      result.building,
    )).toBe(true);
  });

  test('retries with Wien when PLZ-only query fails (Hauptstrasse 5, 1290)', async () => {
    validateDeliveryAddress.mockImplementation(async (candidate) => {
      // Wrong PLZ (with or without Wien) fails; street + Wien resolves.
      if (candidate === 'Hauptstrasse 5, Wien') {
        return {
          formattedAddress: 'Hauptstraße 5, 1140 Wien, Austria',
          lat: 48.2,
          lng: 16.3,
        };
      }
      return null;
    });

    const result = await resolveTypedDeliveryAddress('Hauptstrasse 5, 1290');
    expect(result).toEqual({
      ok: true,
      building: 'Hauptstraße 5, 1140 Wien',
      lat: 48.2,
      lng: 16.3,
    });
    expect(validateDeliveryAddress.mock.calls.map((c) => c[0])).toEqual([
      'Hauptstrasse 5, 1290',
      'Hauptstrasse 5, 1290, Wien',
      'Hauptstrasse 5, Wien',
    ]);
    expect(shouldConfirmDeliveryBuilding('Hauptstrasse 5, 1290', result.building)).toBe(true);
  });

  test('fails closed when validation cannot resolve', async () => {
    validateDeliveryAddress.mockResolvedValue(null);
    await expect(resolveTypedDeliveryAddress('Nowhere 999')).resolves.toEqual({ ok: false });
  });
});
