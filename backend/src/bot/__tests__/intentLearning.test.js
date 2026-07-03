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
const mockCollectionGet = jest.fn().mockResolvedValue({ docs: [] });

jest.mock('../intentLearningPromote', () => ({
  scheduleAliasPromotion: jest.fn(),
}));

jest.mock('../../lib/collections', () => ({
  intentLearningRef: jest.fn(() => ({
    get: mockGet,
    set: mockSet,
    parent: { get: mockCollectionGet },
  })),
}));

const {
  intentLearnKey,
  intentLearnKeyVariants,
  lookupLearnedIntent,
  rememberValidatedIntent,
  rememberValidatedLlmIntent,
  buildBasketPendingLearning,
  _resetIntentLearningMemory,
} = require('../intentLearning');

beforeEach(() => {
  _resetIntentLearningMemory();
  mockGet.mockReset();
  mockSet.mockClear();
  mockCollectionGet.mockReset();
  mockCollectionGet.mockResolvedValue({ docs: [] });
});

describe('intentLearnKey', () => {
  test('normalizes whitespace, polite prefixes, and qty words', () => {
    expect(intentLearnKey('  Zwei Eiern noch dazu bitte  ')).toBe('2 eiern noch dazu');
    expect(intentLearnKey('ich hätte gerne zwei döner')).toBe('2 doner');
  });

  test('strips "für mich" / "was für mich" ordering-for-self filler', () => {
    const core = '1 huhner doner und ne cola';
    expect(intentLearnKey('was für mich ein hühner döner und ne cola')).toBe(core);
    expect(intentLearnKey('für mich ein hühner döner und ne cola')).toBe(core);
    expect(intentLearnKey('ich hätte gerne ein hühner döner und ne cola')).toBe(core);
  });

  test('does not strip "für N personen" party-size phrases', () => {
    expect(intentLearnKey('für 4 personen zwei döner')).toBe('2 doner');
  });
});

describe('lookupLearnedIntent', () => {
  test('returns memory cache without Firestore', async () => {
    rememberValidatedIntent('biz1', 'zwei cola', {
      parsedBy: 'llm',
      items: [{ name: 'cola', qty: 2 }],
      partySize: null,
    }, [{ menuItemId: 'c1', name: 'Cola', qty: 2 }]);
    const hit = await lookupLearnedIntent('biz1', 'zwei cola');
    expect(hit.items).toEqual([{ name: 'Cola', qty: 2, menuItemId: 'c1' }]);
    expect(hit.operation).toBe('add');
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('stores and replays remove operation', async () => {
    rememberValidatedIntent('biz1', 'ayrani cikar', {
      parsedBy: 'rules',
      operation: 'remove',
      items: [{ name: 'ayran', qty: 1 }],
      partySize: null,
    }, [{ menuItemId: 'a1', name: 'Mis Ayran 0.25L', qty: 1, rawName: 'ayran' }]);
    const hit = await lookupLearnedIntent('biz1', 'ayrani cikar');
    expect(hit.operation).toBe('remove');
    expect(hit.items[0].menuItemId).toBe('a1');
  });

  test('cache hit across "was für mich" vs "für mich" wording', async () => {
    const matched = [
      { menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 1 },
      { menuItemId: 'c1', name: 'Coca Cola 0.33L', qty: 1 },
    ];
    rememberValidatedIntent('biz1', 'was für mich ein hühner döner und ne cola', {
      parsedBy: 'llm',
      items: matched.map(m => ({ name: m.name, qty: m.qty })),
      partySize: null,
    }, matched);
    const hit = await lookupLearnedIntent('biz1', 'für mich ein hühner döner und ne cola');
    expect(hit.items.map(i => i.name)).toEqual(matched.map(m => m.name));
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('digit vs word qty resolves via key variants', async () => {
    rememberValidatedIntent('biz1', '2 cola', {
      parsedBy: 'rules',
      items: [{ name: 'cola', qty: 2 }],
    }, [{ menuItemId: 'c1', name: 'Cola', qty: 2 }]);
    const hit = await lookupLearnedIntent('biz1', 'zwei cola');
    expect(hit.items[0].qty).toBe(2);
  });

  test('loads from Firestore on memory miss', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({
        textKey: '2 eiern noch dazu bitte',
        items: [{ name: 'Eiern', qty: 2 }],
        partySize: null,
      }),
    });

    const hit = await lookupLearnedIntent('biz2', 'Zwei Eiern noch dazu bitte');
    expect(hit.items).toEqual([{ name: 'Eiern', qty: 2 }]);
    expect(mockGet).toHaveBeenCalled();
  });

  test('fuzzy matches near-identical phrasing in memory', async () => {
    rememberValidatedIntent('biz1', '2 doner und 1 cola bitte', {
      parsedBy: 'rules',
      items: [{ name: 'Döner', qty: 2 }, { name: 'Cola', qty: 1 }],
    }, [
      { menuItemId: 'd1', name: 'Döner', qty: 2 },
      { menuItemId: 'c1', name: 'Cola', qty: 1 },
    ]);
    const hit = await lookupLearnedIntent('biz1', '2 doner und 1 cola');
    expect(hit.items).toHaveLength(2);
  });
});

describe('rememberValidatedIntent', () => {
  test('persists rules-validated proposals with menuItemId', () => {
    rememberValidatedIntent('biz1', 'zwei cola', {
      parsedBy: 'rules',
      items: [{ name: 'cola', qty: 2 }],
    }, [{ menuItemId: 'c1', name: 'Cola', qty: 2 }]);
    expect(mockSet).toHaveBeenCalled();
    const payload = mockSet.mock.calls[0][0];
    expect(payload.source).toBe('rules');
    expect(payload.items[0].menuItemId).toBe('c1');
  });

  test('ignores learned replay for full save but bumps hitCount', () => {
    rememberValidatedIntent('biz1', 'pizza', {
      parsedBy: 'learned',
      items: [{ name: 'pizza', qty: 1 }],
    });
    expect(mockSet).toHaveBeenCalledTimes(1);
    const payload = mockSet.mock.calls[0][0];
    expect(payload.hitCount).toEqual({ _increment: 1 });
    expect(payload.textKey).toBeUndefined();
  });

  test('rememberValidatedLlmIntent delegates to llm-only path', () => {
    rememberValidatedLlmIntent('biz1', 'Zwei Eiern noch dazu bitte', {
      parsedBy: 'llm',
      items: [{ name: 'Eiern', qty: 2 }],
      partySize: null,
      confidence: 0.9,
    });
    expect(mockSet).toHaveBeenCalled();
  });

  test('rememberValidatedLlmIntent ignores non-llm', () => {
    rememberValidatedLlmIntent('biz1', 'pizza', {
      parsedBy: 'rules',
      items: [{ name: 'pizza', qty: 1 }],
    });
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('buildBasketPendingLearning', () => {
  test('builds add learning from parsed matched items', () => {
    const pending = buildBasketPendingLearning({
      businessId: 'biz1',
      text: 'noch ein ayran',
      parsed: {
        intent: { parsedBy: 'rules', operation: 'add', items: [{ name: 'ayran', qty: 1 }] },
        matched: [{ menuItemId: 'a1', name: 'Ayran', qty: 1 }],
      },
      applyResult: {
        applied: [{ kind: 'add', addedLines: [{ name: 'Ayran', qty: 1 }] }],
      },
    });
    expect(pending).toMatchObject({
      businessId: 'biz1',
      text: 'noch ein ayran',
      matched: [{ menuItemId: 'a1', name: 'Ayran', qty: 1 }],
    });
  });

  test('builds remove learning from removed lines', () => {
    const pending = buildBasketPendingLearning({
      businessId: 'biz1',
      text: 'cola raus',
      parsed: { intent: { parsedBy: 'rules', operation: 'remove', items: [{ name: 'cola', qty: 1 }] } },
      applyResult: {
        applied: [{
          kind: 'remove',
          removedLines: [{ name: 'Coca Cola 0.33L', qty: 1 }],
        }],
      },
    });
    expect(pending).toMatchObject({
      businessId: 'biz1',
      text: 'cola raus',
      intent: expect.objectContaining({ operation: 'remove' }),
    });
    expect(pending.matched[0].name).toBe('Coca Cola 0.33L');
  });

  test('returns null when nothing applied', () => {
    expect(buildBasketPendingLearning({
      businessId: 'biz1',
      text: 'cola raus',
      parsed: {},
      applyResult: { applied: [] },
    })).toBeNull();
  });
});

describe('intentLearnKeyVariants', () => {
  test('returns canonical and legacy keys', () => {
    expect(intentLearnKeyVariants('zwei döner')).toEqual(expect.arrayContaining(['2 doner', 'zwei doner']));
  });
});
