const axios = require('axios');
const {
  validateIntentPayload,
  validateMenuIntentPayload,
  validateCommandPayload,
  parseOrderIntentWithLlm,
  parseBotCommandWithLlm,
  isAiIntentEnabled,
  _resetLlmState,
} = require('../llm');
const { buildMenuLlmIndex } = require('../menuLlmIndex');

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

  test('retries on 503 then succeeds', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'google';
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.LLM_RETRY_ATTEMPTS = '3';
    process.env.LLM_RETRY_DELAY_MS = '1';

    const okResponse = {
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
    };
    const err503 = Object.assign(new Error('503'), {
      response: { status: 503, data: { error: { message: 'high demand' } } },
    });
    axios.post.mockRejectedValueOnce(err503).mockResolvedValueOnce(okResponse);

    const r = await parseOrderIntentWithLlm('pizza', { phone: '+435' });
    expect(r.confidence).toBe(0.9);
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('menu-constrained mode resolves menuItemId to intent items', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'google';
    process.env.GEMINI_API_KEY = 'test-key';

    const menu = [
      { id: 'a1', name: 'Ayran', price: 2, available: true },
      { id: 'd1', name: 'Döner', price: 8, available: true },
    ];

    axios.post.mockResolvedValue({
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                items: [
                  { menuItemId: 'a1', qty: 2, lineText: 'zwei eiern' },
                  { menuItemId: 'd1', qty: 1, lineText: null },
                ],
                partySize: null,
                confidence: 0.92,
              }),
            }],
          },
        }],
      },
    });

    const r = await parseOrderIntentWithLlm('Zwei Eiern und ein Döner', { phone: '+439', menu });
    expect(r.menuConstrained).toBe(true);
    expect(r.items).toEqual([
      { name: 'zwei eiern', qty: 2, menuItemId: 'a1' },
      { name: 'Döner', qty: 1, menuItemId: 'd1' },
    ]);
    const body = axios.post.mock.calls[0][1];
    expect(body.systemInstruction.parts[0].text).toContain('menuItemId');
    expect(body.contents[0].parts[0].text).toContain('id=a1');
  });

  test('validateMenuIntentPayload rejects unknown ids', () => {
    const menuIndex = buildMenuLlmIndex([{ id: 'c1', name: 'Cola', available: true }]);
    const r = validateMenuIntentPayload({
      items: [{ menuItemId: 'missing', qty: 1 }],
      confidence: 0.9,
    }, menuIndex);
    expect(r).toBeNull();
  });

  test('validateMenuIntentPayload repairs Schaf/Eimer over-split', () => {
    const menu = [
      { id: 'k1', name: 'Kebap Sandwich Huhn', category: 'Kebap', available: true },
      { id: 'w1', name: 'Wrap mit Schafskäse', category: 'Wraps', available: true },
      { id: 'c1', name: 'Coca Cola 0.33L', category: 'Getraenke', available: true },
      { id: 'a1', name: 'Mis Ayran 0.25L', category: 'Getraenke', available: true },
    ];
    const menuIndex = buildMenuLlmIndex(menu);
    const r = validateMenuIntentPayload({
      items: [
        { menuItemId: 'k1', lineText: 'Kebab mit allem' },
        { menuItemId: 'w1', lineText: 'Schaf' },
        { menuItemId: 'c1', lineText: 'Eimer' },
      ],
      confidence: 0.7,
    }, menuIndex);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ menuItemId: 'k1', name: 'Kebab mit allem und scharf' });
    expect(r.items[1]).toMatchObject({ menuItemId: 'a1', name: 'ayran' });
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

describe('validateCommandPayload', () => {
  test('accepts view_basket and undo', () => {
    expect(validateCommandPayload({ command: 'view_basket', confidence: 0.95 })).toEqual({
      command: 'view_basket',
      confidence: 0.95,
    });
    expect(validateCommandPayload({ command: 'undo', confidence: 0.9 })).toEqual({
      command: 'undo',
      confidence: 0.9,
    });
  });

  test('rejects unknown command', () => {
    expect(validateCommandPayload({ command: 'add_pizza', confidence: 0.9 })).toBeNull();
  });
});

describe('parseBotCommandWithLlm', () => {
  test('uses command system prompt — not menu-constrained order prompt', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'google';
    process.env.GEMINI_API_KEY = 'test-key';

    axios.post.mockResolvedValue({
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({ command: 'view_basket', confidence: 0.95 }),
            }],
          },
        }],
      },
    });

    const r = await parseBotCommandWithLlm('zeig mal', {
      phone: '+431',
      hasBasket: true,
      hasUndoSnapshot: false,
    });

    expect(r).toEqual({ command: 'view_basket', confidence: 0.95 });
    const body = axios.post.mock.calls[0][1];
    const systemText = body.systemInstruction.parts[0].text;
    const userText = body.contents[0].parts[0].text;

    expect(systemText).toContain('NOT food ordering');
    expect(systemText).toContain('view_basket');
    expect(systemText).not.toContain('MUST be an id from the menu list');
    expect(systemText).not.toContain('menu provided');
    expect(userText).toContain('Basket has items: yes');
    expect(userText).toContain('Undo available: no');
    expect(userText).not.toContain('id=');
    expect(body.generationConfig.responseSchema.properties.command.enum).toEqual(
      ['view_basket', 'undo', 'none'],
    );
  });

  test('returns null on API failure', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.GEMINI_API_KEY = 'test-key';
    axios.post.mockRejectedValue(new Error('timeout'));

    const r = await parseBotCommandWithLlm('zurück', { phone: '+432', hasUndoSnapshot: true });
    expect(r).toBeNull();
  });
});
