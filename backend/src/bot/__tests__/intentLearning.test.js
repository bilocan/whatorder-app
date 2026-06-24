jest.mock('../../lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        increment: jest.fn(n => ({ _increment: n })),
        serverTimestamp: jest.fn(() => ({ _serverTimestamp: true })),
      },
    },
  },
}));

const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/collections', () => ({
  intentLearningRef: jest.fn(() => ({
    get: mockGet,
    set: mockSet,
  })),
}));

const {
  intentLearnKey,
  lookupLearnedIntent,
  rememberValidatedLlmIntent,
  _resetIntentLearningMemory,
} = require('../intentLearning');

beforeEach(() => {
  _resetIntentLearningMemory();
  mockGet.mockReset();
  mockSet.mockClear();
});

describe('intentLearnKey', () => {
  test('normalizes whitespace and polite prefixes', () => {
    expect(intentLearnKey('  Zwei Eiern noch dazu bitte  ')).toBe('zwei eiern noch dazu bitte');
    expect(intentLearnKey('ich hätte gerne zwei döner')).toBe('zwei doner');
  });

  test('strips "für mich" / "was für mich" ordering-for-self filler', () => {
    const core = 'ein huhner doner und ne cola';
    expect(intentLearnKey('was für mich ein hühner döner und ne cola')).toBe(core);
    expect(intentLearnKey('für mich ein hühner döner und ne cola')).toBe(core);
    expect(intentLearnKey('ich hätte gerne ein hühner döner und ne cola')).toBe(core);
  });

  test('does not strip "für N personen" party-size phrases', () => {
    expect(intentLearnKey('für 4 personen zwei döner')).toBe('zwei doner');
  });
});

describe('lookupLearnedIntent', () => {
  test('returns memory cache without Firestore', async () => {
    rememberValidatedLlmIntent('biz1', 'zwei cola', {
      parsedBy: 'llm',
      items: [{ name: 'cola', qty: 2 }],
      partySize: null,
    });
    const hit = await lookupLearnedIntent('biz1', 'zwei cola');
    expect(hit.items).toEqual([{ name: 'cola', qty: 2 }]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('cache hit across "was für mich" vs "für mich" wording', async () => {
    const items = [
      { name: 'Kebap Sandwich Huhn', qty: 1 },
      { name: 'Coca Cola 0.33L', qty: 1 },
    ];
    rememberValidatedLlmIntent('biz1', 'was für mich ein hühner döner und ne cola', {
      parsedBy: 'llm',
      items,
      partySize: null,
    });
    const hit = await lookupLearnedIntent('biz1', 'für mich ein hühner döner und ne cola');
    expect(hit.items).toEqual(items);
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('loads from Firestore on memory miss', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        items: [{ name: 'Eiern', qty: 2 }],
        partySize: null,
      }),
    });

    const hit = await lookupLearnedIntent('biz2', 'Zwei Eiern noch dazu bitte');
    expect(hit.items).toEqual([{ name: 'Eiern', qty: 2 }]);
    expect(mockGet).toHaveBeenCalled();
  });
});

describe('rememberValidatedLlmIntent', () => {
  test('ignores non-llm intents', () => {
    rememberValidatedLlmIntent('biz1', 'pizza', {
      parsedBy: 'rules',
      items: [{ name: 'pizza', qty: 1 }],
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  test('persists validated LLM parse', () => {
    rememberValidatedLlmIntent('biz1', 'Zwei Eiern noch dazu bitte', {
      parsedBy: 'llm',
      items: [{ name: 'Eiern', qty: 2 }],
      partySize: null,
      confidence: 0.9,
    });
    expect(mockSet).toHaveBeenCalled();
  });
});
