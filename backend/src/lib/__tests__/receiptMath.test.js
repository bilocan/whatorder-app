const {
  ALLOWED_VAT_RATES,
  splitGrossCents,
  buildOrderTaxSnapshot,
  defaultVatRateForCategory,
  isValidVatRate,
} = require('../receiptMath');

describe('receiptMath', () => {
  test('allows only supported numeric VAT rates', () => {
    expect(ALLOWED_VAT_RATES).toEqual([0, 10, 20]);
    expect(isValidVatRate(0)).toBe(true);
    expect(isValidVatRate(10)).toBe(true);
    expect(isValidVatRate(20)).toBe(true);
    expect(isValidVatRate('10')).toBe(false);
    expect(isValidVatRate(13)).toBe(false);
  });

  test('defaultVatRateForCategory', () => {
    expect(defaultVatRateForCategory('drinks')).toBe(20);
    expect(defaultVatRateForCategory('mains')).toBe(10);
  });

  test('splitGrossCents 10% on €11.00', () => {
    // 1100 / 1.1 = 1000 net, 100 vat
    expect(splitGrossCents(1100, 10)).toEqual({
      netCents: 1000,
      vatCents: 100,
      grossCents: 1100,
    });
  });

  test('splitGrossCents rounds net and derives VAT as the remainder', () => {
    expect(splitGrossCents(100, 20)).toEqual({
      netCents: 83,
      vatCents: 17,
      grossCents: 100,
    });
  });

  test('buildOrderTaxSnapshot aggregates by rate', () => {
    const snap = buildOrderTaxSnapshot([
      { name: 'Döner', qty: 2, price: 8.5, vatRate: 10 },
      { name: 'Ayran', qty: 1, price: 2.5, vatRate: 20 },
    ]);

    expect(snap.totalGross).toBeCloseTo(19.5, 5);
    expect(snap.totalsByVat['10'].gross).toBeCloseTo(17, 5);
    expect(snap.totalsByVat['20'].gross).toBeCloseTo(2.5, 5);
    expect(snap.items[0]).toMatchObject({ vatRate: 10, qty: 2 });
  });

  test('rejects missing vatRate in buildOrderTaxSnapshot when strict', () => {
    expect(() => buildOrderTaxSnapshot(
      [{ name: 'X', qty: 1, price: 1 }],
      { strict: true },
    )).toThrow(/vatRate/);
  });
});
