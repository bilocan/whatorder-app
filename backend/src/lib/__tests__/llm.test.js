const axios = require('axios');
const {
  validateIntentPayload,
  validateMenuIntentPayload,
  validateCommandPayload,
  parseOrderIntentWithLlm,
  parseBotCommandWithLlm,
  isAiIntentEnabled,
  parsePlaygroundModelEntry,
  resolvePlaygroundModel,
  listPlaygroundModels,
  _resetLlmState,
} = require('../llm');
const { buildMenuLlmIndex } = require('../menuLlmIndex');

jest.mock('axios');
jest.mock('../collections', () => ({
  configRef: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({ exists: false }),
    set: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../firebase', () => ({
  db: {
    runTransaction: jest.fn(async (fn) => {
      const tx = {
        get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: jest.fn(),
      };
      return fn(tx);
    }),
  },
  admin: {},
}));

const ORIGINAL_ENV = process.env;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function enableGoogleLlm(extra = {}) {
  Object.assign(process.env, {
    AI_INTENT_ENABLED: 'true',
    LLM_PROVIDER: 'google',
    GEMINI_API_KEY: 'test-key',
    GEMINI_API_BASE_URL: GEMINI_BASE,
    LLM_MODEL: 'gemini-2.5-flash-lite',
    ...extra,
  });
}

function enableOpenRouterLlm(extra = {}) {
  Object.assign(process.env, {
    AI_INTENT_ENABLED: 'true',
    LLM_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'sk-or-test',
    OPENROUTER_BASE_URL: OPENROUTER_BASE,
    LLM_MODEL: 'google/gemini-2.5-flash-lite',
    ...extra,
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
}

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

  test('accepts quantity / overall_confidence aliases', () => {
    const r = validateIntentPayload({
      items: [{ name: 'Döner', quantity: 2 }],
      overall_confidence: 0.98,
    });
    expect(r.items).toEqual([{ name: 'Döner', qty: 2 }]);
    expect(r.confidence).toBe(0.98);
  });
});

describe('isAiIntentEnabled', () => {
  test('false when flag off', () => {
    process.env.AI_INTENT_ENABLED = 'false';
    process.env.GEMINI_API_KEY = 'key';
    process.env.GEMINI_API_BASE_URL = GEMINI_BASE;
    process.env.LLM_MODEL = 'gemini-2.5-flash-lite';
    expect(isAiIntentEnabled()).toBe(false);
  });

  test('true with google provider, base URL, model, and key', () => {
    enableGoogleLlm();
    expect(isAiIntentEnabled()).toBe(true);
  });

  test('false when google missing GEMINI_API_BASE_URL', () => {
    enableGoogleLlm();
    delete process.env.GEMINI_API_BASE_URL;
    expect(isAiIntentEnabled()).toBe(false);
  });

  test('false when LLM_MODEL missing', () => {
    enableGoogleLlm();
    delete process.env.LLM_MODEL;
    expect(isAiIntentEnabled()).toBe(false);
  });

  test('true with openrouter provider, base URL, model, and key', () => {
    enableOpenRouterLlm();
    expect(isAiIntentEnabled()).toBe(true);
  });

  test('false when openrouter missing base URL', () => {
    enableOpenRouterLlm();
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    expect(isAiIntentEnabled()).toBe(false);
  });

  test('true with openai provider and OPENAI_* env', () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = OPENROUTER_BASE;
    process.env.LLM_MODEL = 'openai/gpt-4o-mini';
    delete process.env.OPENROUTER_API_KEY;
    expect(isAiIntentEnabled()).toBe(true);
  });
});

describe('playground model entries', () => {
  test('OR prefix means openrouter; bare id means direct google', () => {
    expect(parsePlaygroundModelEntry('OR:google/gemini-2.5-flash-lite')).toEqual({
      label: 'OR google/gemini-2.5-flash-lite',
      model: 'google/gemini-2.5-flash-lite',
      provider: 'openrouter',
    });
    expect(parsePlaygroundModelEntry('gemini-2.5-flash-lite')).toEqual({
      label: 'gemini-2.5-flash-lite',
      model: 'gemini-2.5-flash-lite',
      provider: 'google',
    });
  });

  test('resolvePlaygroundModel matches labels from LLM_PLAYGROUND_MODELS', () => {
    enableOpenRouterLlm({
      LLM_PLAYGROUND_MODELS: 'gemini-2.5-flash-lite,OR:google/gemini-2.5-flash-lite',
    });
    const labels = listPlaygroundModels();
    expect(labels).toContain('OR google/gemini-2.5-flash-lite');
    expect(labels).toContain('gemini-2.5-flash-lite');
    expect(resolvePlaygroundModel('gemini-2.5-flash-lite')).toMatchObject({
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
    });
    expect(resolvePlaygroundModel('OR google/gemini-2.5-flash-lite')).toMatchObject({
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
    });
  });
});

describe('parseOrderIntentWithLlm', () => {
  test('calls Gemini and returns parsed intent', async () => {
    enableGoogleLlm();

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
    expect(axios.post).toHaveBeenCalledWith(
      `${GEMINI_BASE}/models/gemini-2.5-flash-lite:generateContent`,
      expect.any(Object),
      expect.any(Object),
    );
  });

  test('returns null on API failure', async () => {
    enableGoogleLlm();
    axios.post.mockRejectedValue(new Error('timeout'));

    const r = await parseOrderIntentWithLlm('pizza', { phone: '+432' });
    expect(r).toBeNull();
  });

  test('retries on 503 then succeeds', async () => {
    enableGoogleLlm({
      LLM_RETRY_ATTEMPTS: '3',
      LLM_RETRY_DELAY_MS: '1',
    });

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
    enableGoogleLlm();

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

  test('openrouter provider posts to env base URL with slug model', async () => {
    enableOpenRouterLlm({
      OPENROUTER_HTTP_REFERER: 'https://whatorder.at',
      OPENROUTER_APP_TITLE: 'WhatOrder',
    });

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              items: [{ name: 'pizza', qty: 1 }],
              partySize: null,
              confidence: 0.91,
            }),
          },
        }],
      },
    });

    const r = await parseOrderIntentWithLlm('eine pizza', { phone: '+440' });
    expect(r.confidence).toBe(0.91);
    expect(axios.post).toHaveBeenCalledWith(
      `${OPENROUTER_BASE}/chat/completions`,
      expect.objectContaining({
        model: 'google/gemini-2.5-flash-lite',
        response_format: expect.objectContaining({ type: 'json_schema' }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-test',
          'HTTP-Referer': 'https://whatorder.at',
          'X-Title': 'WhatOrder',
        }),
      }),
    );
  });

  test('openrouter prefers OPENROUTER_API_KEY over shell OPENAI_API_KEY', async () => {
    enableOpenRouterLlm();
    process.env.OPENAI_API_KEY = 'sk-openai-should-not-win';

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              items: [{ name: 'pizza', qty: 1 }],
              partySize: null,
              confidence: 0.9,
            }),
          },
        }],
      },
    });

    await parseOrderIntentWithLlm('pizza', { phone: '+442' });
    expect(axios.post.mock.calls[0][2].headers.Authorization).toBe('Bearer sk-or-test');
  });

  test('model override is sent in the OpenRouter request body', async () => {
    enableOpenRouterLlm({
      LLM_PLAYGROUND_MODELS: 'OR:google/gemini-2.5-flash-lite,OR:moonshotai/kimi-k2.5',
    });

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              items: [{ name: 'döner', qty: 1 }],
              partySize: null,
              confidence: 0.93,
            }),
          },
        }],
      },
    });

    const r = await parseOrderIntentWithLlm('döner', {
      phone: '+443',
      model: 'moonshotai/kimi-k2.5',
      provider: 'openrouter',
      llmLabel: 'OR moonshotai/kimi-k2.5',
    });
    expect(r.llmModel).toBe('OR moonshotai/kimi-k2.5');
    expect(axios.post.mock.calls[0][1].model).toBe('moonshotai/kimi-k2.5');
  });

  test('provider override routes bare Gemini id to Google generateContent', async () => {
    enableOpenRouterLlm();
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.GEMINI_API_BASE_URL = GEMINI_BASE;

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

    const r = await parseOrderIntentWithLlm('pizza', {
      phone: '+444',
      model: 'gemini-2.5-flash-lite',
      provider: 'google',
      llmLabel: 'gemini-2.5-flash-lite',
    });
    expect(r.llmModel).toBe('gemini-2.5-flash-lite');
    expect(axios.post.mock.calls[0][0]).toBe(
      `${GEMINI_BASE}/models/gemini-2.5-flash-lite:generateContent`,
    );
  });

  test('openai provider uses OPENAI_BASE_URL and LLM_MODEL from env', async () => {
    process.env.AI_INTENT_ENABLED = 'true';
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = OPENROUTER_BASE;
    process.env.LLM_MODEL = 'anthropic/claude-sonnet-4';

    axios.post.mockResolvedValue({
      data: {
        choices: [{
          message: {
            content: JSON.stringify({
              items: [{ name: 'döner', qty: 2 }],
              partySize: null,
              confidence: 0.88,
            }),
          },
        }],
      },
    });

    const r = await parseOrderIntentWithLlm('zwei döner', { phone: '+441' });
    expect(r.items[0].qty).toBe(2);
    expect(axios.post.mock.calls[0][0]).toBe(`${OPENROUTER_BASE}/chat/completions`);
    expect(axios.post.mock.calls[0][1].model).toBe('anthropic/claude-sonnet-4');
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
    enableGoogleLlm({ LLM_RATE_LIMIT_MS: '60000' });

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
    enableGoogleLlm();

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
    enableGoogleLlm();
    axios.post.mockRejectedValue(new Error('timeout'));

    const r = await parseBotCommandWithLlm('zurück', { phone: '+432', hasUndoSnapshot: true });
    expect(r).toBeNull();
  });
});

describe('parseOrderIntentWithLlm fallback', () => {
  const { configRef } = require('../collections');

  test('tries fallback provider once after retryable primary failure', async () => {
    enableGoogleLlm({
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_BASE_URL: OPENROUTER_BASE,
      LLM_PLAYGROUND_MODELS: 'gemini-2.5-flash-lite,OR:google/gemini-2.5-flash-lite',
      LLM_RETRY_ATTEMPTS: '1',
    });
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          aiIntentEnabled: true,
          llmProvider: 'google',
          llmModel: 'gemini-2.5-flash-lite',
          llmFallbackProvider: 'openrouter',
          llmFallbackModel: 'google/gemini-2.5-flash-lite',
        }),
      }),
      set: jest.fn(),
    });

    const err503 = Object.assign(new Error('overloaded'), {
      response: { status: 503, data: { error: { message: 'high demand' } } },
    });
    axios.post
      .mockRejectedValueOnce(err503)
      .mockResolvedValueOnce({
        data: {
          choices: [{
            message: {
              content: JSON.stringify({
                items: [{ name: 'pizza', qty: 1 }],
                partySize: null,
                confidence: 0.9,
              }),
            },
          }],
        },
      });

    const r = await parseOrderIntentWithLlm('pizza', { phone: '+4499' });
    expect(r).not.toBeNull();
    expect(r.items[0].name).toBe('pizza');
    expect(r.llmProvider).toBe('openrouter');
    expect(axios.post).toHaveBeenCalledTimes(2);
    const lastUrl = axios.post.mock.calls[1][0];
    expect(lastUrl).toContain(OPENROUTER_BASE);
  });
});
