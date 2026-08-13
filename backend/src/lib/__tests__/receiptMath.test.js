const {
  ALLOWED_VAT_RATES,
  DEFAULT_DELIVERY_FEE_VAT_RATE,
  FEE_LINE_KIND,
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

  test('no-discount VAT split is stable after aggregating bucket gross', () => {
    const snap = buildOrderTaxSnapshot([
      { name: 'A', qty: 1, price: 1, vatRate: 10 },
      { name: 'B', qty: 1, price: 1.15, vatRate: 10 },
    ]);

    // Aggregate €2.15 gross first, then split: €1.95 net + €0.20 VAT.
    expect(snap.totalsByVat['10']).toEqual({ net: 1.95, vat: 0.2, gross: 2.15 });
  });

  test('rejects missing vatRate in buildOrderTaxSnapshot when strict', () => {
    expect(() => buildOrderTaxSnapshot(
      [{ name: 'X', qty: 1, price: 1 }],
      { strict: true },
    )).toThrow(/vatRate/);
  });

  test('tags the delivery fee line and taxes it at 10% by default', () => {
    const snap = buildOrderTaxSnapshot(
      [{ name: 'Döner', qty: 1, price: 8.5, vatRate: 10 }],
      { deliveryFeeGross: 2.5 },
    );

    expect(DEFAULT_DELIVERY_FEE_VAT_RATE).toBe(10);
    expect(snap.items[1]).toMatchObject({ name: 'Delivery fee', kind: FEE_LINE_KIND, vatRate: 10 });
    expect(snap.totalsByVat['10'].gross).toBeCloseTo(11, 5);
  });

  test('accepts a deliveryFeeVatRate override and keeps the fee in totalsByVat', () => {
    const snap = buildOrderTaxSnapshot(
      [{ name: 'Döner', qty: 1, price: 8.5, vatRate: 10 }],
      { deliveryFeeGross: 2.4, deliveryFeeVatRate: 20 },
    );

    expect(snap.items[1]).toMatchObject({ kind: FEE_LINE_KIND, vatRate: 20 });
    expect(snap.totalsByVat['20']).toEqual({ net: 2, vat: 0.4, gross: 2.4 });
    expect(snap.totalGross).toBeCloseTo(10.9, 5);
  });

  test('rejects an unsupported deliveryFeeVatRate', () => {
    expect(() => buildOrderTaxSnapshot(
      [{ name: 'Döner', qty: 1, price: 8.5, vatRate: 10 }],
      { deliveryFeeGross: 2.5, deliveryFeeVatRate: 13 },
    )).toThrow(/deliveryFeeVatRate/);
  });

  test('leaves basket lines untagged so only the fee is filterable', () => {
    const snap = buildOrderTaxSnapshot(
      [{ name: 'Döner', qty: 1, price: 8.5, vatRate: 10 }],
      { deliveryFeeGross: 2.5 },
    );

    expect(snap.items.filter(item => item.kind === FEE_LINE_KIND)).toHaveLength(1);
    expect(snap.items[0].kind).toBeUndefined();
  });

  test('discountGross allocates across item VAT buckets and leaves fee untouched', () => {
    const snap = buildOrderTaxSnapshot(
      [
        { name: 'Döner', qty: 1, price: 10, vatRate: 10 },
        { name: 'Ayran', qty: 1, price: 2.5, vatRate: 20 },
      ],
      { deliveryFeeGross: 3, discountGross: 2.5 },
    );

    expect(snap.items[0].gross).toBeCloseTo(10, 5);
    expect(snap.items[1].gross).toBeCloseTo(2.5, 5);
    expect(snap.items[2]).toMatchObject({ kind: FEE_LINE_KIND, gross: 3 });

    const allocated =
      (10 + 3 - snap.totalsByVat['10'].gross) + (2.5 - snap.totalsByVat['20'].gross);
    expect(allocated).toBeCloseTo(2.5, 5);
    expect(snap.totalsByVat['10'].gross + snap.totalsByVat['20'].gross).toBeCloseTo(13, 5);
    expect(snap.totalGross).toBeCloseTo(13, 5);
  });

  test('largest remainder distributes leftover cents exactly', () => {
    const snap = buildOrderTaxSnapshot(
      [
        { name: 'A', qty: 1, price: 1.01, vatRate: 10 },
        { name: 'B', qty: 1, price: 1.00, vatRate: 20 },
      ],
      { discountGross: 0.03 },
    );
    const cut10 = 101 - Math.round(snap.totalsByVat['10'].gross * 100);
    const cut20 = 100 - Math.round(snap.totalsByVat['20'].gross * 100);
    expect(cut10 + cut20).toBe(3);
    expect(snap.totalGross).toBeCloseTo(1.98, 5);
  });

  test('omitting discountGross keeps current totals', () => {
    const snap = buildOrderTaxSnapshot(
      [{ name: 'Döner', qty: 1, price: 8.5, vatRate: 10 }],
      { deliveryFeeGross: 2.5 },
    );
    expect(snap.totalGross).toBeCloseTo(11, 5);
  });
});
