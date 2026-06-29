const mockLearningGet = jest.fn();
const mockMenuDocGet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/firebase', () => {
  const firestoreFn = jest.fn(() => ({
    batch: () => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    }),
  }));
  firestoreFn.FieldValue = {
    serverTimestamp: jest.fn(() => ({ _ts: true })),
  };
  return { admin: { firestore: firestoreFn } };
});

jest.mock('../../lib/collections', () => ({
  intentLearningRef: jest.fn(() => ({ get: mockLearningGet })),
  menuRef: jest.fn(() => ({
    doc: jest.fn(() => ({ get: mockMenuDocGet })),
  })),
}));

const {
  DEFAULT_PROMOTE_HIT_THRESHOLD,
  promoteHitThreshold,
  stripLeadingQty,
  aliasCandidatesFromLearning,
  isWorthPromoting,
  filterPromotableAliases,
  maybePromoteLearnedAliases,
} = require('../intentLearningPromote');

beforeEach(() => {
  mockLearningGet.mockReset();
  mockMenuDocGet.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchCommit.mockClear().mockResolvedValue(undefined);
});

describe('stripLeadingQty', () => {
  test('removes leading digit qty', () => {
    expect(stripLeadingQty('2 cola')).toBe('cola');
    expect(stripLeadingQty('peach ice tea')).toBe('peach ice tea');
  });
});

describe('aliasCandidatesFromLearning', () => {
  test('single item uses stripped textKey phrase', () => {
    const groups = aliasCandidatesFromLearning('2 kola', [
      { menuItemId: 'c1', name: 'Coca Cola 0.33L', rawName: 'kola', qty: 2 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].aliases).toEqual(['kola']);
  });

  test('single item includes distinct rawName', () => {
    const groups = aliasCandidatesFromLearning('peach ice tea', [
      { menuItemId: 't1', name: 'Eistee Pfirsich 0.33L', rawName: 'icetea pfirsich', qty: 1 },
    ]);
    expect(groups[0].aliases).toEqual(expect.arrayContaining(['peach ice tea', 'icetea pfirsich']));
  });

  test('multi-item promotes per-item rawName only', () => {
    const groups = aliasCandidatesFromLearning('2 doner und 1 cola', [
      { menuItemId: 'd1', name: 'Döner', rawName: 'doner', qty: 2 },
      { menuItemId: 'c1', name: 'Cola', rawName: 'cola', qty: 1 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].aliases).toEqual(['doner']);
    expect(groups[1].aliases).toEqual(['cola']);
  });

  test('skips rows without menuItemId', () => {
    expect(aliasCandidatesFromLearning('pizza', [{ name: 'Pizza', qty: 1 }])).toEqual([]);
  });
});

describe('isWorthPromoting', () => {
  test('rejects duplicates and menu name', () => {
    expect(isWorthPromoting('Cola 0.33L', 'Cola 0.33L')).toBe(false);
    expect(isWorthPromoting('kola', 'Coca Cola 0.33L', ['kola'])).toBe(false);
  });

  test('accepts distinct customer phrasing', () => {
    expect(isWorthPromoting('peach ice tea', 'Eistee Pfirsich 0.33L')).toBe(true);
    expect(isWorthPromoting('kola', 'Coca Cola 0.33L')).toBe(true);
  });

  test('rejects very short aliases', () => {
    expect(isWorthPromoting('co', 'Coca Cola 0.33L')).toBe(false);
  });
});

describe('filterPromotableAliases', () => {
  test('dedupes and filters', () => {
    const out = filterPromotableAliases(
      ['kola', 'kola', 'Coca Cola 0.33L'],
      'Coca Cola 0.33L',
      [],
    );
    expect(out).toEqual(['kola']);
  });
});

describe('maybePromoteLearnedAliases', () => {
  test('promotes alias when hitCount crosses threshold', async () => {
    mockLearningGet.mockResolvedValue({
      exists: true,
      data: () => ({ hitCount: 3, textKey: 'peach ice tea' }),
    });
    mockMenuDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Eistee Pfirsich 0.33L', aliases: [] }),
    });

    const result = await maybePromoteLearnedAliases('biz1', 'doc1', 'peach ice tea', [
      { menuItemId: 't1', name: 'Eistee Pfirsich 0.33L', qty: 1 },
    ]);

    expect(result.promoted).toBe(true);
    expect(result.promotedAliases).toEqual([{ menuItemId: 't1', alias: 'peach ice tea' }]);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('skips when below threshold', async () => {
    mockLearningGet.mockResolvedValue({
      exists: true,
      data: () => ({ hitCount: 2 }),
    });

    const result = await maybePromoteLearnedAliases('biz1', 'doc1', 'kola', [
      { menuItemId: 'c1', name: 'Cola', qty: 1 },
    ]);

    expect(result.promoted).toBe(false);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('skips when already promoted', async () => {
    mockLearningGet.mockResolvedValue({
      exists: true,
      data: () => ({ hitCount: 5, aliasesPromotedAt: { _ts: true } }),
    });

    const result = await maybePromoteLearnedAliases('biz1', 'doc1', 'kola', [
      { menuItemId: 'c1', name: 'Cola', qty: 1 },
    ]);

    expect(result.promoted).toBe(false);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

describe('promoteHitThreshold', () => {
  const prev = process.env.INTENT_ALIAS_PROMOTE_MIN_HITS;

  afterEach(() => {
    if (prev === undefined) delete process.env.INTENT_ALIAS_PROMOTE_MIN_HITS;
    else process.env.INTENT_ALIAS_PROMOTE_MIN_HITS = prev;
  });

  test('defaults to 3', () => {
    delete process.env.INTENT_ALIAS_PROMOTE_MIN_HITS;
    expect(promoteHitThreshold()).toBe(DEFAULT_PROMOTE_HIT_THRESHOLD);
  });

  test('reads INTENT_ALIAS_PROMOTE_MIN_HITS', () => {
    process.env.INTENT_ALIAS_PROMOTE_MIN_HITS = '1';
    expect(promoteHitThreshold()).toBe(1);
  });
});

describe('DEFAULT_PROMOTE_HIT_THRESHOLD', () => {
  test('is at least 1', () => {
    expect(DEFAULT_PROMOTE_HIT_THRESHOLD).toBeGreaterThanOrEqual(1);
  });
});
