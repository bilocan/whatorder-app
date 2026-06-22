const axios = require('axios');
const {
  validateIntentPayload,
  parseOrderIntentWithLlm,
  isAiIntentEnabled,
  _resetLlmState,
} = require('../llm');

jest.mock('axios');

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  _resetLlmState();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('validateIntentPayload', () => {
  test('accepts valid intent JSON', () => {
    const r = validateIntentPayload({
      items: [{ name: 'pizza', qty: 2 }, { name: 'cola', qty: null }],
      partySize: 2,
      confidence: 0.9,
    });
    expect(r.items).toEqual([
      { name: 'pizza', qty: 2 },
      { name: 'cola', qty: null },
    ]);
    expect(r.partySize).toBe(2);
    expect(r.confidence).toBe(0.9);
  });

  test('rejects missing confidence', () => {
    expect(validateIntentPayload({ items: [{ name: 'pizza' }] })).toBeNull();
  });
});

describe('isAiIntentEnabled', () => {
  test('false when flag off', () => {
    process.env.AI_INTENT_ENABLED = 'false';
    process.env.GEMINI_API_KEY = 'key';
    expect(isAiIntentEnabled()).toBe(false);
  });

  test('true with google provider and key', () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'google';
    process.env.GEMINI_API_KEY = 'key';
    expect(isAiIntentEnabled()).toBe(true);
  });
});

describe('parseOrderIntentWithLlm', () => {
  test('calls Gemini and returns parsed intent', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'google';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.LLM_MODEL = 'gemini-2.5-flash-lite';

    axios.post.mockResolvedValue({
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                items: [{ name: 'chicken döner', qty: 2 }, { name: 'cola', qty: 1 }],
                partySize: null,
                confidence: 0.95,
              }),
            }],
          },
        }],
      },
    });

    const r = await parseOrderIntentWithLlm('two chicken döner and a cola', { phone: '+431' });
    expect(r.confidence).toBe(0.95);
    expect(r.items).toHaveLength(2);
    expect(axios.post).toHaveBeenCalled();
  });

  test('returns null on API failure', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
    axios.post.mockRejectedValue(new Error('timeout'));

    const r = await parseOrderIntentWithLlm('pizza', { phone: '+432' });
    expect(r).toBeNull();
  });

  test('rate limits repeat calls from same phone', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.LLM_RATE_LIMIT_MS = '60000';

    axios.post.mockResolvedValue({
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                items: [{ name: 'pizza', qty: 1 }],
                partySize: null,
                confidence: 0.9,
              }),
            }],
          },
        }],
      },
    });

    const phone = '+433';
    expect(await parseOrderIntentWithLlm('pizza', { phone })).not.toBeNull();
    expect(await parseOrderIntentWithLlm('cola', { phone })).toBeNull();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
