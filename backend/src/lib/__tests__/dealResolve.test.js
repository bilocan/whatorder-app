jest.mock('../collections', () => ({
  ordersRef: jest.fn(),
}));

const { ordersRef } = require('../collections');
const { resolveDeal, defaultDealLabel, toMillis, marketingDealLabel } = require('../dealResolve');

const NOW = new Date('2026-08-12T12:00:00.000Z');
const FO = {
  dealId: 'fo1',
  kind: 'first_order',
  discountType: 'percent',
  discountValue: 10,
  label: '10% Willkommen',
  active: true,
};
const WIN = {
  dealId: 'w1',
  kind: 'window',
  discountType: 'fixed',
  discountValue: 2,
  label: '€2 Lunch',
  active: true,
  startsAt: new Date('2026-08-01T00:00:00.000Z'),
  endsAt: new Date('2026-08-31T23:59:59.000Z'),
};

function mockBurn(empty) {
  const chain = {
    where: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    get: jest.fn().mockResolvedValue({ empty, docs: empty ? [] : [{ id: 'o1' }] }),
  };
  ordersRef.mockReturnValue(chain);
  return chain;
}

describe('marketingDealLabel', () => {
  test('returns null when deals map is missing', () => {
    expect(marketingDealLabel({}, NOW)).toBeNull();
    expect(ordersRef).not.toHaveBeenCalled();
  });

  test('prefers live first-order label even if a window is also live', () => {
    expect(marketingDealLabel({ deals: { firstOrder: FO, window: WIN } }, NOW)).toBe('10% Willkommen');
    expect(ordersRef).not.toHaveBeenCalled();
  });

  test('does not query orders (returning diner still sees FO badge)', () => {
    marketingDealLabel({ deals: { firstOrder: FO } }, NOW);
    expect(ordersRef).not.toHaveBeenCalled();
  });

  test('falls back to window when first-order is paused', () => {
    expect(marketingDealLabel({
      deals: { firstOrder: { ...FO, active: false }, window: WIN },
    }, NOW)).toBe('€2 Lunch');
  });

  test('returns null when window is out of range', () => {
    expect(marketingDealLabel({
      deals: { window: { ...WIN, endsAt: new Date('2026-08-01T00:00:00.000Z') } },
    }, NOW)).toBeNull();
  });

  test('uses defaultDealLabel when stored label is empty', () => {
    expect(marketingDealLabel({
      deals: { firstOrder: { ...FO, label: '' } },
    }, NOW)).toBe('10% Rabatt');
  });
});

describe('resolveDeal', () => {
  test('returns null when deals map is missing', async () => {
    await expect(resolveDeal({
      businessId: 'b1', business: {}, customerId: '43699111', subtotal: 20, now: NOW,
    })).resolves.toBeNull();
    expect(ordersRef).not.toHaveBeenCalled();
  });

  test('first-order wins over window when both eligible', async () => {
    mockBurn(true);
    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: FO, window: WIN } },
      customerId: '+43 699 111',
      subtotal: 20,
      now: NOW,
    });
    expect(deal).toMatchObject({
      dealId: 'fo1', kind: 'first_order', discountCents: 200, discount: 2, label: '10% Willkommen',
    });
    const chain = ordersRef.mock.results[0].value;
    expect(chain.where).toHaveBeenCalledWith('customerId', '==', '43699111');
    expect(chain.where).toHaveBeenCalledWith('status', 'in', ['delivered', 'picked_up']);
  });

  test('window only when first-order burned by delivered/picked_up', async () => {
    mockBurn(false);
    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: FO, window: WIN } },
      customerId: '43699111',
      subtotal: 20,
      now: NOW,
    });
    expect(deal).toMatchObject({ dealId: 'w1', kind: 'window', discountCents: 200, discount: 2 });
  });

  test('skips first-order and still considers window when burn query fails', async () => {
    const chain = {
      where: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      get: jest.fn().mockRejectedValue(new Error('FAILED_PRECONDITION: missing index')),
    };
    ordersRef.mockReturnValue(chain);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: FO, window: WIN } },
      customerId: '43699111',
      subtotal: 20,
      now: NOW,
    });

    expect(deal).toMatchObject({ dealId: 'w1', kind: 'window' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/firestore indexes/i),
      expect.stringContaining('FAILED_PRECONDITION'),
    );
    warn.mockRestore();
  });

  test('paused or out-of-window slot does not apply', async () => {
    await expect(resolveDeal({
      businessId: 'b1',
      business: { deals: { window: { ...WIN, active: false } } },
      customerId: '1', subtotal: 20, now: NOW,
    })).resolves.toBeNull();

    await expect(resolveDeal({
      businessId: 'b1',
      business: { deals: { window: { ...WIN, endsAt: new Date('2026-08-01T00:00:00.000Z') } } },
      customerId: '1', subtotal: 20, now: NOW,
    })).resolves.toBeNull();
  });

  test('cancelled/rejected do not burn first-order (query only delivered/picked_up)', async () => {
    mockBurn(true);
    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: FO } },
      customerId: '43699111',
      subtotal: 10,
      now: NOW,
    });
    expect(deal.kind).toBe('first_order');
  });

  test('fixed discount caps at subtotal', async () => {
    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { window: { ...WIN, discountValue: 50 } } },
      customerId: '1',
      subtotal: 7.5,
      now: NOW,
    });
    expect(deal.discountCents).toBe(750);
    expect(deal.discount).toBe(7.5);
  });

  test('percent uses half-up cents and allows one decimal', async () => {
    mockBurn(true);
    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: { ...FO, discountValue: 10.5 } } },
      customerId: '43699111',
      subtotal: 19.99,
      now: NOW,
    });
    // 1999 * 10.5 / 100 = 209.895 → 210 cents
    expect(deal.discountCents).toBe(210);
  });

  test('missing label uses defaultDealLabel', () => {
    expect(defaultDealLabel({ discountType: 'percent', discountValue: 10 })).toBe('10% Rabatt');
    expect(defaultDealLabel({ discountType: 'fixed', discountValue: 2 })).toBe('€2.00 Rabatt');
  });

  test('returns discountValue as number', async () => {
    mockBurn(true);
    const deal = await resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: FO } },
      customerId: '43699111',
      subtotal: 20,
      now: NOW,
    });
    expect(typeof deal.discountValue).toBe('number');
    expect(deal.discountValue).toBe(10);
  });

  test.each([
    ['invalid Date startsAt', { startsAt: new Date('not-a-date') }],
    ['invalid Timestamp-like startsAt', { startsAt: { seconds: NaN } }],
    ['invalid Date endsAt', { endsAt: new Date('not-a-date') }],
    ['invalid Timestamp-like endsAt', { endsAt: { seconds: NaN, nanoseconds: 0 } }],
  ])('window slot with %s returns null (fail closed)', async (_, overrides) => {
    await expect(resolveDeal({
      businessId: 'b1',
      business: { deals: { window: { ...WIN, ...overrides } } },
      customerId: '1',
      subtotal: 20,
      now: NOW,
    })).resolves.toBeNull();
  });

  test.each([
    ['toMillis', {
      startsAt: { toMillis: () => new Date('2026-08-01T00:00:00.000Z').getTime() },
      endsAt: { toMillis: () => new Date('2026-08-31T23:59:59.000Z').getTime() },
    }],
    ['seconds and nanoseconds', {
      startsAt: { seconds: 1785542400, nanoseconds: 0 },
      endsAt: { seconds: 1788220799, nanoseconds: 999000000 },
    }],
  ])('window accepts in-range Firestore Timestamp fixture using %s', async (_, timestamps) => {
    await expect(resolveDeal({
      businessId: 'b1',
      business: { deals: { window: { ...WIN, ...timestamps } } },
      customerId: '1',
      subtotal: 20,
      now: NOW,
    })).resolves.toMatchObject({ dealId: 'w1', kind: 'window' });
  });

  test.each([
    ['invalid Date', new Date('not-a-date')],
    ['NaN from toMillis()', { toMillis: () => NaN }],
    ['Timestamp-like with NaN seconds', { seconds: NaN }],
  ])('toMillis returns null for %s', (_, value) => {
    expect(toMillis(value)).toBeNull();
  });

  test.each([
    ['string "10"', '10'],
    ['missing', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('rejects %s discountValue (no deal)', async (_, discountValue) => {
    mockBurn(true);
    const slot = { ...FO };
    if (discountValue === undefined) {
      delete slot.discountValue;
    } else {
      slot.discountValue = discountValue;
    }
    await expect(resolveDeal({
      businessId: 'b1',
      business: { deals: { firstOrder: slot } },
      customerId: '43699111',
      subtotal: 20,
      now: NOW,
    })).resolves.toBeNull();
  });
});
