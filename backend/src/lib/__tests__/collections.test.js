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
  ownerRef, adminRef, processedMessageRef,
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
