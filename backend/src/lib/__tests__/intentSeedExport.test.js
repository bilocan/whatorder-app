const {
  eligibleSeedRow,
  seedEntryFromRow,
  buildSeedFile,
} = require('../intentSeedExport');

const MENU_IDS = new Set(['m1', 'm2']);
const CTX = { minHits: 3, menuIds: MENU_IDS };

function row(overrides = {}) {
  return {
    textKey: '2 doner',
    items: [{ name: 'Döner Kebap', qty: 2, menuItemId: 'm1' }],
    hitCount: 5,
    operation: 'add',
    source: 'llm',
    ...overrides,
  };
}

describe('eligibleSeedRow', () => {
  test('accepts a validated high-hit row', () => {
    expect(eligibleSeedRow(row(), CTX)).toEqual({ eligible: true });
  });

  test('rejects missing textKey', () => {
    expect(eligibleSeedRow(row({ textKey: '' }), CTX).reason).toBe('missing_textKey');
  });

  test('rejects phone-number-like digit runs (privacy)', () => {
    expect(eligibleSeedRow(row({ textKey: 'ruf 066012345 an' }), CTX).reason).toBe('privacy_digit_run');
    // short qty digits stay eligible
    expect(eligibleSeedRow(row({ textKey: '12 doner' }), CTX).eligible).toBe(true);
  });

  test('rejects below min hits', () => {
    expect(eligibleSeedRow(row({ hitCount: 2 }), CTX).reason).toBe('below_min_hits');
    expect(eligibleSeedRow(row({ hitCount: undefined }), CTX).reason).toBe('below_min_hits');
  });

  test('rejects empty or malformed items', () => {
    expect(eligibleSeedRow(row({ items: [] }), CTX).reason).toBe('no_items');
    expect(eligibleSeedRow(row({ items: [{ qty: 2 }] }), CTX).reason).toBe('malformed_items');
  });

  test('rejects items whose menuItemId no longer resolves', () => {
    expect(eligibleSeedRow(
      row({ items: [{ name: 'Döner', qty: 1, menuItemId: 'gone' }] }),
      CTX,
    ).reason).toBe('stale_menu_item');
  });

  test('name-only items (no menuItemId) stay eligible — runtime repair rebinds them', () => {
    expect(eligibleSeedRow(row({ items: [{ name: 'Döner', qty: 1 }] }), CTX).eligible).toBe(true);
  });
});

describe('seedEntryFromRow', () => {
  test('carries docId, provenance, and normalizes operation', () => {
    const entry = seedEntryFromRow('doc1', row({ operation: 'weird' }));
    expect(entry).toEqual({
      docId: 'doc1',
      items: [{ name: 'Döner Kebap', qty: 2, menuItemId: 'm1' }],
      partySize: null,
      operation: 'add',
      source: 'llm',
      hitCount: 5,
    });
    expect(seedEntryFromRow('doc1', row({ operation: 'remove' })).operation).toBe('remove');
  });
});

describe('buildSeedFile', () => {
  test('sorts businesses and textKeys deterministically, drops empty businesses', () => {
    const seed = buildSeedFile({
      biz_b: { 'z key': { docId: '1' }, 'a key': { docId: '2' } },
      biz_a: { 'm key': { docId: '3' } },
      biz_empty: {},
    }, { release: 'v1.9.0', generatedAt: '2026-07-14T00:00:00.000Z' });

    expect(seed.release).toBe('v1.9.0');
    expect(Object.keys(seed.businesses)).toEqual(['biz_a', 'biz_b']);
    expect(Object.keys(seed.businesses.biz_b)).toEqual(['a key', 'z key']);
    expect(seed.businesses.biz_empty).toBeUndefined();
  });
});
