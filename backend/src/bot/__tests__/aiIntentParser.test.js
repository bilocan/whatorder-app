jest.mock('../../lib/llm');

const { parseOrderIntentWithLlm, canCallLlm } = require('../../lib/llm');
const { parseIntentAsync, rulesParseQuality, shouldTryLlm } = require('../intentParser');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
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
});
