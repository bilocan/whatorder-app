const {
  checkOrder,
  checkBusinessRouting,
  checkSession,
  checkIntentLearning,
  checkCustomerAggregates,
  countOrdersByCustomer,
  parseTimestamp,
  checkOwnerDoc,
  checkBusinessesWithoutOwner,
  checkDuplicateOwnerPhones,
  normalizeOwnerPhone,
  getOwnerBusinessIds,
} = require('../firestoreAuditChecks');

describe('parseTimestamp', () => {
  it('parses ISO strings', () => {
    expect(parseTimestamp('2026-06-01T12:00:00.000Z')).toBeInstanceOf(Date);
  });

  it('returns null for invalid values', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('not-a-date')).toBeNull();
  });
});

describe('checkOrder', () => {
  it('passes a valid order', () => {
    expect(
      checkOrder({
        id: 'o1',
        data: {
          status: 'pending',
          items: [{ name: 'Döner', qty: 1, price: 8.5 }],
          total: 8.5,
          createdAt: '2026-06-01T12:00:00.000Z',
        },
      }),
    ).toEqual([]);
  });

  it('flags missing fields and invalid status', () => {
    const issues = checkOrder({ id: 'bad', data: { status: 'unknown' } });
    expect(issues.some((i) => i.includes('invalid status'))).toBe(true);
    expect(issues.some((i) => i.includes('missing or empty items'))).toBe(true);
    expect(issues.some((i) => i.includes('missing total'))).toBe(true);
  });
});

describe('checkBusinessRouting', () => {
  it('separates orphans from protected businesses', () => {
    const result = checkBusinessRouting(
      ['routed_biz', 'missing_biz'],
      ['biz_enes_kebap_9450w', 'orphan_biz', 'routed_biz'],
    );
    expect(result.routingMissingBusiness).toEqual(['missing_biz']);
    expect(result.protectedOrphans).toEqual(['biz_enes_kebap_9450w']);
    expect(result.orphanBusinesses).toEqual(['orphan_biz']);
  });
});

describe('checkSession', () => {
  it('flags session pointing at missing business', () => {
    const issues = checkSession(
      { id: '+431234', data: { businessId: 'gone', updatedAt: new Date() } },
      new Set(['biz_a']),
    );
    expect(issues[0]).toContain('does not exist');
  });
});

describe('checkIntentLearning', () => {
  it('flags menu names not in catalog', () => {
    const menuNames = new Set(['döner']);
    const issues = checkIntentLearning(
      { id: 'abc', data: { items: [{ name: 'Pizza', qty: 1 }] } },
      menuNames,
    );
    expect(issues[0]).toContain('not in menu');
  });
});

describe('checkCustomerAggregates', () => {
  it('flags orderCount mismatch', () => {
    const issues = checkCustomerAggregates(
      { id: '+43123', data: { orderCount: 5 } },
      2,
    );
    expect(issues[0]).toContain('orderCount=5');
  });
});

describe('countOrdersByCustomer', () => {
  const normalize = (p) => String(p).replace(/\D/g, '');

  it('groups orders by normalized phone', () => {
    const counts = countOrdersByCustomer(
      [
        { id: 'o1', data: { customerId: '+43699111222' } },
        { id: 'o2', data: { customerPhone: '43699111222' } },
        { id: 'o3', data: { customerId: '+43699333444' } },
      ],
      normalize,
    );
    expect(counts.get('43699111222')).toBe(2);
    expect(counts.get('43699333444')).toBe(1);
  });
});

describe('normalizeOwnerPhone', () => {
  it('normalizes to E.164', () => {
    expect(normalizeOwnerPhone('4368120714531')).toBe('+4368120714531');
    expect(normalizeOwnerPhone('+43 681 207 145 31')).toBe('+4368120714531');
  });
});

describe('getOwnerBusinessIds', () => {
  it('prefers businessIds array over legacy businessId', () => {
    expect(getOwnerBusinessIds({ businessId: 'a', businessIds: ['b', 'c'] })).toEqual(['b', 'c']);
  });

  it('falls back to legacy businessId', () => {
    expect(getOwnerBusinessIds({ businessId: 'a' })).toEqual(['a']);
  });
});

describe('checkOwnerDoc', () => {
  const businessIdSet = new Set(['biz_pizza', 'biz_test']);

  it('flags stored phone mismatch vs Auth (Pizza Dorf pattern)', () => {
    const issues = checkOwnerDoc(
      {
        id: 'uid_a',
        data: { phone: '+4368120714531', businessId: 'biz_pizza' },
      },
      { auth: { exists: true, phone: '+905423458516' }, businessIdSet },
    );
    expect(issues.some((i) => i.includes('stored phone'))).toBe(true);
    expect(issues.some((i) => i.includes('legacy businessId only'))).toBe(true);
  });

  it('passes when Auth phone matches stored phone', () => {
    const issues = checkOwnerDoc(
      {
        id: 'uid_b',
        data: { phone: '+4368120714531', businessIds: ['biz_test'] },
      },
      { auth: { exists: true, phone: '+4368120714531' }, businessIdSet },
    );
    expect(issues).toEqual([]);
  });
});

describe('checkDuplicateOwnerPhones', () => {
  it('flags same phone on multiple owner docs', () => {
    const issues = checkDuplicateOwnerPhones([
      { id: 'u1', data: { phone: '+43123' } },
      { id: 'u2', data: { phone: '+43123' } },
    ]);
    expect(issues[0]).toContain('2 docs');
  });
});

describe('checkBusinessesWithoutOwner', () => {
  it('flags businesses with no owner link', () => {
    const issues = checkBusinessesWithoutOwner(
      ['biz_a', 'biz_b'],
      [{ id: 'u1', data: { businessIds: ['biz_a'] } }],
    );
    expect(issues).toEqual(['businesses/biz_b: no owner linked (dashboard login unavailable)']);
  });
});
