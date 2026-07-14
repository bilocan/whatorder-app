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
const mockOverridesGet = jest.fn();

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
    get: jest.fn().mockResolvedValue({ exists: false }),
    set: jest.fn().mockResolvedValue(undefined),
  })),
  seedOverridesRef: jest.fn(() => ({
    get: mockOverridesGet,
    set: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { evaluateIntent } = require('../intentSandbox');
const { _setSeedForTests, _resetSeedForTests } = require('../intentSeed');
const { _resetIntentLearningMemory } = require('../intentLearning');

const MENU = [
  { id: 'm1', name: 'Döner Kebap', price: 8.5, available: true },
  { id: 'c1', name: 'Cola', price: 2.5, available: true },
];

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
  mockOverridesGet.mockResolvedValue({ exists: false });
});

afterAll(() => {
  _resetSeedForTests();
});

describe('evaluateIntent learnedSource (playground tier selector)', () => {
  test("learnedSource 'seed' replays a baked phrase with provenance", async () => {
    const result = await evaluateIntent('zwei döner', {
      menu: MENU,
      businessId: 'biz1',
      learnedSource: 'seed',
    });
    expect(result.outcome).toBe('proposal');
    expect(result.intent.parsedBy).toBe('learned');
    expect(result.intent.learnedFrom).toBe('seed');
    expect(result.matched[0].menuItemId).toBe('m1');
  });

  test("learnedSource 'seed' reports no_seed_match when the phrase is not baked", async () => {
    const result = await evaluateIntent('1 cola', {
      menu: MENU,
      businessId: 'biz1',
      learnedSource: 'seed',
    });
    expect(result.outcome).toBe('no_seed_match');
    expect(result.matched).toEqual([]);
  });

  test("learnedSource 'any' reports no_learned_match when nothing was learned", async () => {
    const result = await evaluateIntent('1 cola', {
      menu: MENU,
      businessId: 'biz1',
      learnedSource: 'any',
    });
    expect(result.outcome).toBe('no_learned_match');
  });

  test('without learnedSource the pipeline still falls through to rules', async () => {
    const result = await evaluateIntent('1 cola', {
      menu: MENU,
      businessId: 'biz1',
    });
    expect(result.outcome).toBe('proposal');
    expect(result.intent.parsedBy).toBe('rules');
  });
});
