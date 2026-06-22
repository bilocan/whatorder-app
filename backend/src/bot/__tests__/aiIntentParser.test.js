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

  test('low for conversational single blob', () => {
    expect(rulesParseQuality('zum mitnehmen zwei döner einer mit allem einer ohne zwiebeln')).toBe('low');
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
        { name: 'Döner mit allem', qty: 1 },
        { name: 'Döner ohne Zwiebeln', qty: 1 },
      ],
      partySize: null,
      confidence: 0.92,
    });

    const r = await parseIntentAsync(
      'zum mitnehmen zwei döner einer mit allem einer ohne zwiebeln',
      { phone: '+432' },
    );

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
});

describe('shouldTryLlm', () => {
  test('false when rules quality is high', () => {
    const rules = { items: [{ name: 'Döner', qty: 2 }, { name: 'ayran', qty: 1 }], partySize: null };
    expect(shouldTryLlm('2 Döner 1 ayran', rules, '+435')).toBe(false);
  });
});
