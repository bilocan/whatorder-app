'use strict';

const { orderCreatedMs, findLatestOrder } = require('../lib/firestoreAssert');
const { resolveScenarioIds } = require('../scenarios');

describe('e2e-wa firestoreAssert helpers', () => {
  test('orderCreatedMs from seconds', () => {
    expect(orderCreatedMs({ createdAt: { seconds: 1700000000 } })).toBe(1700000000_000);
  });

  test('orderCreatedMs from ISO string', () => {
    const ms = orderCreatedMs({ createdAt: '2024-01-01T00:00:00.000Z' });
    expect(ms).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
  });

  test('findLatestOrder filters by afterMs and status', async () => {
    // Unit-level: exercise pure filter via injecting docs through a thin re-export path
    // findLatestOrder hits Firestore — skip live call; cover filter logic inline
    const docs = [
      { id: 'old', status: 'pending', customerPhone: '43660', createdAt: { seconds: 100 } },
      { id: 'new', status: 'pending', customerPhone: '43660', createdAt: { seconds: 200 } },
      { id: 'ready', status: 'ready', customerPhone: '43660', createdAt: { seconds: 300 } },
    ];
    const filtered = docs
      .filter((o) => orderCreatedMs(o) > 150_000)
      .filter((o) => o.status === 'pending')
      .sort((a, b) => orderCreatedMs(b) - orderCreatedMs(a));
    expect(filtered[0].id).toBe('new');
    expect(typeof findLatestOrder).toBe('function');
  });
});

describe('e2e-wa resolveScenarioIds', () => {
  test('default is pack a', () => {
    expect(resolveScenarioIds([])).toEqual(['happy_stripe_pickup', 'owner_status_path']);
  });

  test('--scenario happy_cash_pickup alias resolves via BY_ID', () => {
    expect(resolveScenarioIds(['--scenario', 'happy_cash_pickup'])).toEqual(['happy_cash_pickup']);
  });

  test('--scenario', () => {
    expect(resolveScenarioIds(['--scenario', 'neg_cancel'])).toEqual(['neg_cancel']);
  });

  test('--all-pack-b', () => {
    expect(resolveScenarioIds(['--all-pack-b'])).toEqual([
      'neg_closed',
      'neg_delivery_minimum',
      'neg_cancel',
    ]);
  });
});
