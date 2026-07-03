jest.mock('../../lib/llm');

const mockLookupLearnedIntent = jest.fn().mockResolvedValue(null);

jest.mock('../intentLearning', () => ({
  lookupLearnedIntent: (...args) => mockLookupLearnedIntent(...args),
  normalizeOperation: (op) => (op === 'remove' ? 'remove' : 'add'),
  rememberValidatedIntent: jest.fn(),
  rememberValidatedLlmIntent: jest.fn(),
  _resetIntentLearningMemory: jest.fn(),
}));

const { parseOrderIntentWithLlm, canCallLlm } = require('../../lib/llm');
const { parseIntentAsync, rulesParseQuality, shouldTryLlm } = require('../intentParser');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  mockLookupLearnedIntent.mockResolvedValue(null);
  process.env = { ...ORIGINAL_ENV, AI_INTENT_ENABLED: 'true', GEMINI_API_KEY: 'key' };
  canCallLlm.mockReturnValue(true);
  parseOrderIntentWithLlm.mockResolvedValue(null);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('rulesParseQuality', () => {
  test('high for structured multi-item orders', () => {
    expect(rulesParseQuality('2 Döner 1 ayran')).toBe('high');
    expect(rulesParseQuality('2x döner und cola')).toBe('high');
  });

  test('high for zwei döner einer mit allem einer ohne zwiebeln', () => {
    expect(rulesParseQuality('zum mitnehmen zwei döner einer mit allem einer ohne zwiebeln')).toBe('high');
  });

  test('high for zwei kebab eine mit allem und andere ohne', () => {
    const text = 'ich hätte gerne zwei Hühner Kebab eine mit allem und andere ohne Schaf und Soße bitte';
    expect(rulesParseQuality(text)).toBe('high');
  });

  test('high for food + drink pair without conjunction', () => {
    expect(rulesParseQuality('Lahmacun cola')).toBe('high');
  });

  test('low for conversational single blob without structure', () => {
    expect(rulesParseQuality('was empfehlt ihr für heute abend')).toBe('low');
  });
});

describe('parseIntentAsync', () => {
  test('uses rules only when parse quality is high', async () => {
    const r = await parseIntentAsync('2 Döner 1 ayran', { phone: '+431' });
    expect(r.parsedBy).toBe('rules');
    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
  });

  test('uses LLM for messy text when rules quality is low', async () => {
    parseOrderIntentWithLlm.mockResolvedValue({
      items: [
        { name: 'Pizza Margherita', qty: 1 },
        { name: 'Cola', qty: 1 },
      ],
      partySize: null,
      confidence: 0.92,
    });

    const r = await parseIntentAsync('was empfehlt ihr für heute abend', { phone: '+432' });

    expect(parseOrderIntentWithLlm).toHaveBeenCalled();
    expect(r.parsedBy).toBe('llm');
    expect(r.items).toHaveLength(2);
  });

  test('falls back to rules when LLM confidence is low', async () => {
    parseOrderIntentWithLlm.mockResolvedValue({
      items: [{ name: 'something', qty: 1 }],
      partySize: null,
      confidence: 0.3,
    });

    const r = await parseIntentAsync('was empfehlt ihr', { phone: '+433' });
    expect(r.parsedBy).toBe('rules');
  });

  test('falls back to rules when LLM returns null', async () => {
    parseOrderIntentWithLlm.mockResolvedValue(null);

    const r = await parseIntentAsync('something light for the kids', { phone: '+434' });
    expect(r.parsedBy).toBe('rules');
  });

  test('keeps rules per-unit modifier split without calling LLM', async () => {
    const text = 'ich hätte gerne zwei Hühner Kebab eine mit allem und andere ohne Schaf und Soße bitte';
    const r = await parseIntentAsync(text, { phone: '+437' });

    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
    expect(r.parsedBy).toBe('rules');
    expect(r.items).toHaveLength(2);
  });

  test('repairs bad learned over-split when menu is available', async () => {
    mockLookupLearnedIntent.mockResolvedValueOnce({
      items: [
        { name: 'Kebab mit allem', qty: 1, menuItemId: 'enes-kebap-sandwich-huhn' },
        { name: 'Schaf', qty: 1, menuItemId: 'enes-wrap-schafskase' },
        { name: 'Eimer', qty: 1, menuItemId: 'enes-getr-cola-033' },
      ],
      partySize: null,
    });

    const menu = [
      { id: 'enes-kebap-sandwich-huhn', name: 'Kebap Sandwich Huhn', category: 'Kebap', available: true },
      { id: 'enes-wrap-schafskase', name: 'Wrap mit Schafskäse', category: 'Wraps', available: true },
      { id: 'enes-getr-cola-033', name: 'Coca Cola 0.33L', category: 'Getraenke', available: true },
      { id: 'enes-getr-ayran-025', name: 'Mis Ayran 0.25L', category: 'Getraenke', available: true },
    ];

    const r = await parseIntentAsync(
      'Hallo ich hätte einen Kebab mit allem und Schaf und ein Eimer bitte',
      { phone: '+438', businessId: 'biz_enes_kebap_9450w', menu },
    );

    expect(r.parsedBy).toBe('learned');
    expect(r.items).toHaveLength(2);
    expect(r.items[0].menuItemId).toBe('enes-kebap-sandwich-huhn');
    expect(r.items[0].name).toMatch(/und scharf/i);
    expect(r.items[1].menuItemId).toBe('enes-getr-ayran-025');
    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
  });

  test('uses learned intent before LLM when business has cache hit', async () => {
    mockLookupLearnedIntent.mockResolvedValueOnce({
      items: [{ name: 'Eiern', qty: 2 }],
      partySize: null,
    });

    const r = await parseIntentAsync('Zwei Eiern noch dazu bitte', {
      phone: '+438',
      businessId: 'biz_learn',
    });

    expect(r.parsedBy).toBe('learned');
    expect(r.items).toEqual([{ name: 'Eiern', qty: 2 }]);
    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
  });

  test('uses rules only for single-word menu keywords without calling LLM', async () => {
    for (const word of ['schnitzel', 'döner']) {
      jest.clearAllMocks();
      canCallLlm.mockReturnValue(true);
      parseOrderIntentWithLlm.mockResolvedValue(null);

      const r = await parseIntentAsync(word, { phone: '+439' });

      expect(r.parsedBy).toBe('rules');
      expect(r.items).toEqual([{ name: word, qty: 1 }]);
      expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
    }
  });

  test('uses rules for Lahmacun cola food+drink pair without calling LLM', async () => {
    const r = await parseIntentAsync('Lahmacun cola', { phone: '+441' });
    expect(r.parsedBy).toBe('rules');
    expect(r.items).toEqual([
      { name: 'Lahmacun', qty: 1 },
      { name: 'cola', qty: 1 },
    ]);
    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
  });

  test('uses rules for single item with mit allem ohne scharf without calling LLM', async () => {
    const r = await parseIntentAsync('döner mit allem ohne scharf', { phone: '+440' });
    expect(r.parsedBy).toBe('rules');
    expect(r.items).toEqual([{ name: 'döner mit allem ohne scharf', qty: 1 }]);
    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
  });

  test('ayrani cikar is structural remove not add', async () => {
    const r = await parseIntentAsync('ayrani cikar', { phone: '+442', businessId: 'biz1' });
    expect(r.operation).toBe('remove');
    expect(r.parsedBy).toBe('rules');
    expect(r.items).toEqual([{ name: 'ayrani', qty: 1 }]);
    expect(parseOrderIntentWithLlm).not.toHaveBeenCalled();
  });

  test('entferne ayran is structural remove', async () => {
    const r = await parseIntentAsync('entferne ayran', { phone: '+444', businessId: 'biz1' });
    expect(r.operation).toBe('remove');
    expect(r.items).toEqual([{ name: 'ayran', qty: 1 }]);
  });

  test('entferne 1 ayran keeps qty on remove', async () => {
    const r = await parseIntentAsync('entferne 1 ayran', { phone: '+445' });
    expect(r.operation).toBe('remove');
    expect(r.items).toEqual([{ name: 'ayran', qty: 1 }]);
  });

  test('skips wrong add learning when phrase is structural remove', async () => {
    mockLookupLearnedIntent.mockResolvedValue({
      items: [{ name: 'Mis Ayran 0.25L', qty: 1, menuItemId: 'a1' }],
      partySize: null,
      operation: 'add',
    });
    const r = await parseIntentAsync('ayrani cikar', { phone: '+443', businessId: 'biz1' });
    expect(r.operation).toBe('remove');
    expect(r.parsedBy).toBe('rules');
  });
});

describe('shouldTryLlm', () => {
  test('false when rules quality is high', () => {
    const rules = { items: [{ name: 'Döner', qty: 2 }, { name: 'ayran', qty: 1 }], partySize: null };
    expect(shouldTryLlm('2 Döner 1 ayran', rules, '+435')).toBe(false);
  });

  test('false when rules split per-unit modifiers even with AI enabled', () => {
    const { parseIntent } = require('../intentParser');
    const text = 'ich hätte gerne zwei Hühner Kebab eine mit allem und andere ohne Schaf und Soße bitte';
    const rules = parseIntent(text);
    expect(shouldTryLlm(text, rules, '+436')).toBe(false);
  });

  test('false for single-word menu keywords', () => {
    const { parseIntent } = require('../intentParser');
    for (const word of ['schnitzel', 'döner', 'cola']) {
      const rules = parseIntent(word);
      expect(shouldTryLlm(word, rules, '+437')).toBe(false);
    }
  });

  test('true for multi-word conversational blob', () => {
    const { parseIntent } = require('../intentParser');
    const text = 'something light for the kids';
    const rules = parseIntent(text);
    expect(shouldTryLlm(text, rules, '+438')).toBe(true);
  });

  test('false for single item with mit allem ohne scharf', () => {
    const { parseIntent } = require('../intentParser');
    const text = 'döner mit allem ohne scharf';
    const rules = parseIntent(text);
    expect(shouldTryLlm(text, rules, '+439')).toBe(false);
  });
});
