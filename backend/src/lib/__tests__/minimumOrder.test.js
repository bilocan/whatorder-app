const {
  extractPostalCode,
  normalizeMinimumOrderByDistrict,
  deliveryPostalCodes,
  deliversToPostalCode,
  resolveMinimumOrderValue,
  resolveCheckoutPostalCode,
  summarizeDeliveryMinimumOrders,
} = require('../minimumOrder');
const { orderTotals } = require('../../bot/orderTotals');

/** Favoriten pizza pilot: free delivery, three districts only. */
const FAVORITEN = {
  deliveryEnabled: true,
  deliveryFee: 0,
  minimumOrderByDistrict: [
    { postalCodes: ['1100'], minimumOrderValue: 13 },
    { postalCodes: ['1040', '1050'], minimumOrderValue: 30 },
  ],
};

describe('extractPostalCode', () => {
  test('parses street + PLZ + Wien', () => {
    expect(extractPostalCode('Favoritenstraße 88, 1100 Wien')).toBe('1100');
  });

  test('accepts bare PLZ', () => {
    expect(extractPostalCode('1040')).toBe('1040');
  });

  test('prefers PLZ before city over earlier 4-digit tokens', () => {
    expect(extractPostalCode('Top 1234, Hippgasse 11, 1160 Wien')).toBe('1160');
  });

  test('returns null when missing', () => {
    expect(extractPostalCode('Wien')).toBeNull();
    expect(extractPostalCode('')).toBeNull();
    expect(extractPostalCode(null)).toBeNull();
  });
});

describe('normalizeMinimumOrderByDistrict / deliveryPostalCodes', () => {
  test('keeps valid rows and flattens PLZs', () => {
    expect(normalizeMinimumOrderByDistrict([
      { postalCodes: ['1100', '1100', 'bad'], minimumOrderValue: 13 },
      { postalCodes: '1040, 1050', minimumOrderValue: 30 },
    ])).toEqual([
      { postalCodes: ['1100'], minimumOrderValue: 13 },
      { postalCodes: ['1040', '1050'], minimumOrderValue: 30 },
    ]);
    expect(deliveryPostalCodes(FAVORITEN)).toEqual(['1100', '1040', '1050']);
  });
});

describe('deliversToPostalCode', () => {
  test('Favoriten covers only configured districts', () => {
    expect(deliversToPostalCode(FAVORITEN, '1100 Wien')).toBe(true);
    expect(deliversToPostalCode(FAVORITEN, '1040')).toBe(true);
    expect(deliversToPostalCode(FAVORITEN, '1050 Wien')).toBe(true);
    expect(deliversToPostalCode(FAVORITEN, '1060 Wien')).toBe(false);
    expect(deliversToPostalCode(FAVORITEN, null)).toBe(false);
  });

  test('pickup-only restaurants are not zone-gated', () => {
    expect(deliversToPostalCode({ deliveryEnabled: false }, '1060')).toBe(true);
  });

  test('delivery enabled with empty districts covers everything (legacy)', () => {
    expect(deliversToPostalCode({ deliveryEnabled: true, minimumOrderByDistrict: [] }, '1100')).toBe(true);
  });
});

describe('resolveMinimumOrderValue — districts vs legacy', () => {
  test('1100 → €13, 1040/1050 → €30', () => {
    expect(resolveMinimumOrderValue(FAVORITEN, 'Favoritenstraße 1, 1100 Wien')).toBe(13);
    expect(resolveMinimumOrderValue(FAVORITEN, '1040 Wien')).toBe(30);
    expect(resolveMinimumOrderValue(FAVORITEN, '1050 Wien')).toBe(30);
  });

  test('with districts: unmatched or unknown PLZ returns 0 (no global fallback)', () => {
    expect(resolveMinimumOrderValue(FAVORITEN, '1060 Wien')).toBe(0);
    expect(resolveMinimumOrderValue(FAVORITEN, null)).toBe(0);
    expect(resolveMinimumOrderValue({
      ...FAVORITEN,
      minimumOrderValue: 99,
    }, null)).toBe(0);
  });

  test('without districts: legacy flat minimumOrderValue still applies', () => {
    expect(resolveMinimumOrderValue({ minimumOrderValue: 20 }, null)).toBe(20);
    expect(resolveMinimumOrderValue({ minimumOrderValue: 20 }, '1100 Wien')).toBe(20);
  });

  test('resolveCheckoutPostalCode: address PLZ wins; pin only when address empty', () => {
    expect(resolveCheckoutPostalCode({ customerPlz: '1100' }, '1040 Wien')).toBe('1040');
    expect(resolveCheckoutPostalCode({ customerPlz: '1100' }, '')).toBe('1100');
    expect(resolveCheckoutPostalCode({}, null)).toBeNull();
  });

  test('resolveCheckoutPostalCode does not inherit pin when address has no PLZ', () => {
    expect(resolveCheckoutPostalCode(
      { customerPlz: '1100' },
      'Hauptstrasse 1, Wien',
    )).toBeNull();
  });
});

describe('summarizeDeliveryMinimumOrders', () => {
  test('single amount when all districts share one min', () => {
    expect(summarizeDeliveryMinimumOrders({
      deliveryEnabled: true,
      minimumOrderByDistrict: [
        { postalCodes: ['1100', '1040'], minimumOrderValue: 13 },
      ],
    })).toEqual({ kind: 'single', amount: 13 });
  });

  test('byDistrict when amounts differ', () => {
    expect(summarizeDeliveryMinimumOrders(FAVORITEN)).toEqual({
      kind: 'byDistrict',
      rows: [
        { postalCodes: ['1100'], amount: 13 },
        { postalCodes: ['1040', '1050'], amount: 30 },
      ],
    });
  });

  test('legacy flat min when no districts', () => {
    expect(summarizeDeliveryMinimumOrders({
      deliveryEnabled: true,
      minimumOrderValue: 10,
    })).toEqual({ kind: 'single', amount: 10 });
  });

  test('null when pickup-only or no positive min', () => {
    expect(summarizeDeliveryMinimumOrders({ deliveryEnabled: false, minimumOrderValue: 10 })).toBeNull();
    expect(summarizeDeliveryMinimumOrders({ deliveryEnabled: true })).toBeNull();
  });
});

describe('Favoriten deliveryFee 0 with district min', () => {
  const basket = [{ name: 'Pizza Margherita', qty: 1, price: 15 }];

  test('fee stays 0; min gates by PLZ only when covered', () => {
    const totals = orderTotals(basket, { orderType: 'delivery' }, FAVORITEN);
    expect(totals.deliveryFee).toBe(0);
    expect(totals.total).toBe(15);
    expect(resolveMinimumOrderValue(FAVORITEN, '1100')).toBe(13);
    expect(15 >= 13).toBe(true);
    expect(resolveMinimumOrderValue(FAVORITEN, '1040')).toBe(30);
    expect(15 >= 30).toBe(false);
  });
});
