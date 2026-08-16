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

  test('fails closed when validation cannot resolve', async () => {
    validateDeliveryAddress.mockResolvedValue(null);
    await expect(resolveTypedDeliveryAddress('Nowhere 999')).resolves.toEqual({ ok: false });
  });
});
