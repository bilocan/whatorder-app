jest.mock('../../lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        increment: jest.fn(n => ({ _increment: n })),
        serverTimestamp: jest.fn(() => ({ _serverTimestamp: true })),
        arrayUnion: jest.fn((...vals) => ({ _arrayUnion: vals })),
        delete: jest.fn(() => ({ _delete: true })),
      },
    },
  },
}));

const mockLearningGet = jest.fn();
const mockLearningSet = jest.fn().mockResolvedValue(undefined);
const mockLearningCollectionGet = jest.fn().mockResolvedValue({ docs: [] });
const mockSeededGet = jest.fn();
const mockSeededSet = jest.fn().mockResolvedValue(undefined);
const mockOverridesGet = jest.fn();
const mockOverridesSet = jest.fn().mockResolvedValue(undefined);

jest.mock('../intentLearningPromote', () => ({
  scheduleAliasPromotion: jest.fn(),
}));

jest.mock('../../lib/collections', () => ({
  intentLearningRef: jest.fn(() => ({
    get: mockLearningGet,
    set: mockLearningSet,
    parent: { get: mockLearningCollectionGet },
  })),
  seededIntentRef: jest.fn(() => ({
    get: mockSeededGet,
    set: mockSeededSet,
  })),
  seedOverridesRef: jest.fn(() => ({
    get: mockOverridesGet,
    set: mockOverridesSet,
  })),
}));

const { seededIntentRef, intentLearningRef, seedOverridesRef } = require('../../lib/collections');
const { scheduleAliasPromotion } = require('../intentLearningPromote');
const {
  seedEnabled,
  seedEntriesForBusiness,
  seedEntryForKey,
  _setSeedForTests,
  _resetSeedForTests,
} = require('../intentSeed');
const {
  lookupLearnedIntent,
  lookupLearnedMeta,
  recordLearnedIntentHit,
  saveOwnerIntentLearning,
  _resetIntentLearningMemory,
} = require('../intentLearning');

const SEED = {
  generatedAt: '2026-07-14T00:00:00.000Z',
  release: 'v1.9.0',
  businesses: {
    biz1: {
      '2 doner': {
        docId: 'seeddoc1',
        items: [{ name: 'Döner Kebap', qty: 2, menuItemId: 'm1' }],
        partySize: null,
        operation: 'add',
        source: 'llm',
        hitCount: 7,
      },
    },
  },
};

beforeEach(() => {
  _resetIntentLearningMemory();
  _setSeedForTests(SEED);
  jest.clearAllMocks();
  mockLearningGet.mockResolvedValue({ exists: false });
  mockLearningCollectionGet.mockResolvedValue({ docs: [] });
  mockSeededGet.mockResolvedValue({ exists: false });
  mockOverridesGet.mockResolvedValue({ exists: false });
  delete process.env.INTENT_SEED_DISABLED;
});

afterAll(() => {
  _resetSeedForTests();
  delete process.env.INTENT_SEED_DISABLED;
});

describe('intentSeed module', () => {
  test('seedEnabled respects INTENT_SEED_DISABLED', () => {
    expect(seedEnabled()).toBe(true);
    process.env.INTENT_SEED_DISABLED = '1';
    expect(seedEnabled()).toBe(false);
  });

  test('seedEntriesForBusiness returns {} for unknown business or disabled seed', () => {
    expect(Object.keys(seedEntriesForBusiness('biz1'))).toEqual(['2 doner']);
    expect(seedEntriesForBusiness('biz_other')).toEqual({});
    process.env.INTENT_SEED_DISABLED = '1';
    expect(seedEntriesForBusiness('biz1')).toEqual({});
  });

  test('seedEntryForKey ignoreDisabled sees the seed while the kill switch is on', () => {
    process.env.INTENT_SEED_DISABLED = '1';
    expect(seedEntryForKey('biz1', '2 doner')).toBeNull();
    expect(seedEntryForKey('biz1', '2 doner', { ignoreDisabled: true })?.docId).toBe('seeddoc1');
  });
});

describe('seed hydration in lookupLearnedIntent', () => {
  test('replays a seeded phrase without touching intentLearnings', async () => {
    const hit = await lookupLearnedIntent('biz1', 'zwei döner');
    expect(hit).not.toBeNull();
    expect(hit.items[0]).toEqual({ name: 'Döner Kebap', qty: 2, menuItemId: 'm1' });
    expect(hit.origin).toBe('seed');
    expect(mockLearningGet).not.toHaveBeenCalled();
    // one overrides read per business, cached afterwards
    expect(mockOverridesGet).toHaveBeenCalledTimes(1);
    await lookupLearnedIntent('biz1', 'zwei döner');
    expect(mockOverridesGet).toHaveBeenCalledTimes(1);
  });

  test('kill switch disables the seed layer', async () => {
    process.env.INTENT_SEED_DISABLED = '1';
    const hit = await lookupLearnedIntent('biz1', 'zwei döner');
    expect(hit).toBeNull();
    expect(mockOverridesGet).not.toHaveBeenCalled();
    expect(mockLearningGet).toHaveBeenCalled();
  });

  test('overridden textKey is not hydrated from the seed', async () => {
    mockOverridesGet.mockResolvedValue({ exists: true, data: () => ({ textKeys: ['2 doner'] }) });
    const hit = await lookupLearnedIntent('biz1', 'zwei döner');
    expect(hit).toBeNull();
    expect(mockLearningGet).toHaveBeenCalled(); // fell through to Firestore
  });

  test('business without seed entries skips the overrides read', async () => {
    await lookupLearnedIntent('biz_other', 'zwei döner');
    expect(mockOverridesGet).not.toHaveBeenCalled();
  });
});

describe('recordLearnedIntentHit routing', () => {
  test('seed-origin hit increments the seededIntents doc, not intentLearnings', async () => {
    await lookupLearnedIntent('biz1', 'zwei döner'); // hydrate
    mockLearningSet.mockClear();
    recordLearnedIntentHit('biz1', 'zwei döner');
    await new Promise(setImmediate);
    expect(seededIntentRef).toHaveBeenCalledWith('biz1', 'seeddoc1');
    expect(mockSeededSet).toHaveBeenCalledWith(
      expect.objectContaining({ hitCount: { _increment: 1 } }),
      { merge: true },
    );
    expect(mockLearningSet).not.toHaveBeenCalled();
    expect(scheduleAliasPromotion).toHaveBeenCalledWith(
      'biz1', 'seeddoc1', '2 doner', expect.any(Array), { seeded: true },
    );
  });

  test('non-seeded hit keeps writing to intentLearnings', async () => {
    recordLearnedIntentHit('biz2', 'drei cola');
    await new Promise(setImmediate);
    expect(mockLearningSet).toHaveBeenCalled();
    expect(mockSeededSet).not.toHaveBeenCalled();
  });
});

describe('lookupLearnedMeta with seeded rows', () => {
  test('falls back to the seededIntents archive doc', async () => {
    mockLearningGet.mockResolvedValue({ exists: false });
    mockSeededGet.mockResolvedValue({
      exists: true,
      data: () => ({
        textKey: '2 doner',
        items: [{ name: 'Döner Kebap', qty: 2, menuItemId: 'm1' }],
        hitCount: 7,
        source: 'llm',
        operation: 'add',
        seededInRelease: 'v1.9.0',
      }),
    });
    const meta = await lookupLearnedMeta('biz1', 'zwei döner');
    expect(meta).not.toBeNull();
    expect(meta.seeded).toBe(true);
    expect(meta.seededInRelease).toBe('v1.9.0');
    expect(meta.id).toBe('seeddoc1');
  });

  test('live intentLearnings doc shadows the archived seed copy', async () => {
    mockLearningGet.mockResolvedValue({
      exists: true,
      data: () => ({
        textKey: '2 doner',
        items: [{ name: 'Corrected Döner', qty: 2, menuItemId: 'm9' }],
        hitCount: 1,
        source: 'manual_correction',
        operation: 'add',
      }),
    });
    const meta = await lookupLearnedMeta('biz1', 'zwei döner');
    expect(meta.items[0].menuItemId).toBe('m9');
    expect(meta.seeded).toBeUndefined();
  });
});

describe('saveOwnerIntentLearning seed override', () => {
  test('correcting a seeded phrase records an override and stamps the archive', async () => {
    await saveOwnerIntentLearning('biz1', 'zwei döner', [
      { name: 'Döner Kebap Spezial', qty: 2, menuItemId: 'm2' },
    ]);
    expect(seedOverridesRef).toHaveBeenCalledWith('biz1');
    expect(mockOverridesSet).toHaveBeenCalledWith(
      expect.objectContaining({ textKeys: { _arrayUnion: ['2 doner'] } }),
      { merge: true },
    );
    expect(seededIntentRef).toHaveBeenCalledWith('biz1', 'seeddoc1');
    expect(mockSeededSet).toHaveBeenCalledWith(
      expect.objectContaining({ supersededAt: { _serverTimestamp: true } }),
      { merge: true },
    );
  });

  test('override write holds even while the kill switch is on', async () => {
    process.env.INTENT_SEED_DISABLED = '1';
    await saveOwnerIntentLearning('biz1', 'zwei döner', [
      { name: 'Döner Kebap Spezial', qty: 2, menuItemId: 'm2' },
    ]);
    expect(mockOverridesSet).toHaveBeenCalled();
  });

  test('non-seeded phrase writes no override', async () => {
    await saveOwnerIntentLearning('biz1', 'vier ayran', [
      { name: 'Ayran', qty: 4, menuItemId: 'a1' },
    ]);
    expect(mockOverridesSet).not.toHaveBeenCalled();
  });

  test('corrected seeded phrase replays the correction, not the seed', async () => {
    await saveOwnerIntentLearning('biz1', 'zwei döner', [
      { name: 'Döner Kebap Spezial', qty: 2, menuItemId: 'm2' },
    ]);
    const hit = await lookupLearnedIntent('biz1', 'zwei döner');
    expect(hit.items[0].menuItemId).toBe('m2');
    expect(hit.origin).toBeUndefined();
  });
});
