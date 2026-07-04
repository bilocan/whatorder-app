// Mock firebase before requiring collections so the Admin SDK never initialises.
// The chain mock returns itself from collection() and doc() so we can track
// every call in order via toHaveBeenNthCalledWith.
jest.mock('../firebase', () => {
  const chain = {};
  chain.collection = jest.fn(() => chain);
  chain.doc = jest.fn(() => chain);
  return { db: chain, admin: {} };
});

const { db } = require('../firebase');
const {
  businessRef, menuRef, ordersRef, customersRef, phoneRoutingRef,
  ownerRef, adminRef, processedMessageRef, stripeEventRef, configRef,
  settlementConfigRef, payoutsRef, payoutRef, intentLearningRef, commandLearningRef,
} = require('../collections');

beforeEach(() => {
  db.collection.mockClear();
  db.doc.mockClear();
});

describe('businessRef', () => {
  test('calls businesses collection then doc with businessId', () => {
    businessRef('biz_test');
    expect(db.collection).toHaveBeenCalledWith('businesses');
    expect(db.doc).toHaveBeenCalledWith('biz_test');
  });

  test('returns a value (not null/undefined)', () => {
    expect(businessRef('biz_test')).toBeDefined();
  });
});

describe('menuRef', () => {
  test('builds path: businesses/{id}/menu', () => {
    menuRef('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(1, 'businesses');
    expect(db.doc).toHaveBeenCalledWith('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(2, 'menu');
  });
});

describe('ordersRef', () => {
  test('builds path: businesses/{id}/orders', () => {
    ordersRef('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(1, 'businesses');
    expect(db.doc).toHaveBeenCalledWith('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(2, 'orders');
  });
});

describe('customersRef', () => {
  test('builds path: businesses/{id}/customers', () => {
    customersRef('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(1, 'businesses');
    expect(db.doc).toHaveBeenCalledWith('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(2, 'customers');
  });
});

describe('phoneRoutingRef', () => {
  test('builds path: phoneRouting/{phoneNumberId}', () => {
    phoneRoutingRef('12345678');
    expect(db.collection).toHaveBeenCalledWith('phoneRouting');
    expect(db.doc).toHaveBeenCalledWith('12345678');
  });
});

describe('ownerRef', () => {
  test('builds path: owners/{uid}', () => {
    ownerRef('uid_abc');
    expect(db.collection).toHaveBeenCalledWith('owners');
    expect(db.doc).toHaveBeenCalledWith('uid_abc');
  });
});

describe('adminRef', () => {
  test('builds path: admins/{uid}', () => {
    adminRef('uid_abc');
    expect(db.collection).toHaveBeenCalledWith('admins');
    expect(db.doc).toHaveBeenCalledWith('uid_abc');
  });
});

describe('processedMessageRef', () => {
  test('builds path: processedMessages/{wamid}', () => {
    processedMessageRef('wamid_xyz');
    expect(db.collection).toHaveBeenCalledWith('processedMessages');
    expect(db.doc).toHaveBeenCalledWith('wamid_xyz');
  });
});

describe('stripeEventRef', () => {
  test('builds path: stripeEvents/{eventId}', () => {
    stripeEventRef('evt_123');
    expect(db.collection).toHaveBeenCalledWith('stripeEvents');
    expect(db.doc).toHaveBeenCalledWith('evt_123');
  });
});

describe('configRef', () => {
  test('builds path: config/whatorder', () => {
    configRef();
    expect(db.collection).toHaveBeenCalledWith('config');
    expect(db.doc).toHaveBeenCalledWith('whatorder');
  });
});

describe('settlementConfigRef', () => {
  test('builds path: config/settlement', () => {
    settlementConfigRef();
    expect(db.collection).toHaveBeenCalledWith('config');
    expect(db.doc).toHaveBeenCalledWith('settlement');
  });
});

describe('payoutsRef', () => {
  test('builds path: payouts', () => {
    payoutsRef();
    expect(db.collection).toHaveBeenCalledWith('payouts');
  });
});

describe('payoutRef', () => {
  test('builds path: payouts/{id}', () => {
    payoutRef('pay_1');
    expect(db.collection).toHaveBeenCalledWith('payouts');
    expect(db.doc).toHaveBeenCalledWith('pay_1');
  });
});

describe('intentLearningRef', () => {
  test('builds path: businesses/{id}/intentLearnings/{keyHash}', () => {
    intentLearningRef('biz_test', 'abc123');
    expect(db.collection).toHaveBeenNthCalledWith(1, 'businesses');
    expect(db.doc).toHaveBeenCalledWith('biz_test');
    expect(db.collection).toHaveBeenNthCalledWith(2, 'intentLearnings');
    expect(db.doc).toHaveBeenCalledWith('abc123');
  });
});

describe('commandLearningRef', () => {
  test('builds path: commandLearnings/{keyHash}', () => {
    commandLearningRef('abc123');
    expect(db.collection).toHaveBeenCalledWith('commandLearnings');
    expect(db.doc).toHaveBeenCalledWith('abc123');
  });
});
