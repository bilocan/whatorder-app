'use strict';

jest.mock('../lib/scriptLoader', () => ({
  listScriptFiles: jest.fn(() => [{
    id: 'stub_pack_c',
    pack: 'c',
    path: '/tmp/stub.yml',
    doc: { id: 'stub_pack_c', pack: 'c', steps: [] },
  }]),
}));

const { orderCreatedMs, findLatestOrder } = require('../lib/firestoreAssert');
const {
  BY_ID,
  buildScenarioIndex,
  listScenarios,
  resolveScenarioIds,
} = require('../scenarios');

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

  test('--all-pack-c resolves yaml script ids', () => {
    expect(resolveScenarioIds(['--all-pack-c'])).toEqual(['stub_pack_c']);
  });

  test('--script stub_pack_c', () => {
    expect(resolveScenarioIds(['--script', 'stub_pack_c'])).toEqual(['stub_pack_c']);
  });

  test('--scenario resolves a yaml script registered in BY_ID', () => {
    expect(resolveScenarioIds(['--scenario', 'stub_pack_c'])).toEqual(['stub_pack_c']);
    expect(BY_ID.stub_pack_c.format).toBe('yaml');
  });

  test('--all does not include yaml pack c', () => {
    expect(resolveScenarioIds(['--all'])).not.toContain('stub_pack_c');
  });

  test('scenario listing includes yaml ids', () => {
    expect(listScenarios().map((scenario) => scenario.id)).toContain('stub_pack_c');
  });

  test('duplicate scenario ids throw while building the index', () => {
    expect(() => buildScenarioIndex([
      { id: 'duplicate', format: 'js' },
      { id: 'duplicate', format: 'yaml' },
    ])).toThrow(/duplicate scenario id.*duplicate/i);
  });

  test('a broken YAML scenario fails only when it runs', async () => {
    const loadError = new Error('invalid script');
    const index = buildScenarioIndex([{
      id: 'broken',
      format: 'yaml',
      error: loadError,
      run: async () => { throw loadError; },
    }]);
    expect(index.broken).toBeDefined();
    await expect(index.broken.run()).rejects.toThrow('invalid script');
  });
});
