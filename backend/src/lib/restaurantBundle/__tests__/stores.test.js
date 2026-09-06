const { storesForProfile, RESTAURANT_STORES, NEVER_STORES } = require('../stores');

describe('storesForProfile', () => {
  test('setup includes menu, optionGroups, deals, learnings, not orders', () => {
    const ids = storesForProfile('setup').map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([
      'business', 'menu', 'optionGroups', 'deals',
      'intentLearnings', 'seededIntents', 'seedOverrides',
      'owners', 'menuPhotos', 'coverImage',
    ]));
    expect(ids).not.toContain('orders');
    expect(ids).not.toContain('customers');
    expect(ids).not.toContain('receipts');
    expect(ids).not.toContain('receiptPdfs');
  });

  test('full includes setup plus transactional stores', () => {
    const ids = storesForProfile('full').map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([
      'business', 'menu', 'orders', 'customers', 'receipts', 'receiptCounter', 'receiptPdfs',
    ]));
  });

  test('unknown profile throws', () => {
    expect(() => storesForProfile('partial')).toThrow(/unknown profile/i);
  });
});

describe('registry completeness', () => {
  test('every restaurant-scoped store is classified setup, full-only, or never', () => {
    const classified = new Set([
      ...RESTAURANT_STORES.map((s) => s.id),
      ...NEVER_STORES,
    ]);
    const required = [
      'business', 'menu', 'optionGroups', 'deals', 'intentLearnings',
      'seededIntents', 'seedOverrides', 'orders', 'customers', 'receipts',
      'receiptCounter', 'owners', 'menuPhotos', 'coverImage', 'receiptPdfs',
      'sessions', 'processedMessages', 'stripeEvents', 'payouts', 'admins',
      'configWhatorder', 'configSettlement', 'commandLearnings', 'phoneRouting',
    ];
    required.forEach((id) => {
      expect(classified.has(id)).toBe(true);
    });
  });

  test('phoneRouting is never auto-copied (opt-in attach only)', () => {
    expect(NEVER_STORES).toContain('phoneRouting');
    expect(storesForProfile('setup').map((s) => s.id)).not.toContain('phoneRouting');
    expect(storesForProfile('full').map((s) => s.id)).not.toContain('phoneRouting');
  });
});
