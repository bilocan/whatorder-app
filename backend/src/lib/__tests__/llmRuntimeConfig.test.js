jest.mock('../collections', () => ({
  configRef: jest.fn(),
}));

const { configRef } = require('../collections');
const {
  getEnvLlmCatalog,
  getLlmRuntimeSelection,
  saveLlmRuntimeSelection,
  invalidateLlmRuntimeCache,
  mergeSelection,
} = require('../llmRuntimeConfig');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const ORIGINAL_ENV = process.env;

function enableBothProviders() {
  Object.assign(process.env, {
    AI_INTENT_ENABLED: 'true',
    LLM_PROVIDER: 'google',
    LLM_MODEL: 'gemini-2.5-flash-lite',
    GEMINI_API_KEY: 'g-key',
    GEMINI_API_BASE_URL: GEMINI_BASE,
    OPENROUTER_API_KEY: 'or-key',
    OPENROUTER_BASE_URL: OPENROUTER_BASE,
    LLM_PLAYGROUND_MODELS: 'gemini-2.5-flash-lite,OR:google/gemini-2.5-flash-lite,OR:deepseek/deepseek-v4-flash',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidateLlmRuntimeCache();
  process.env = { ...ORIGINAL_ENV };
  enableBothProviders();
  configRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({ exists: false }),
    set: jest.fn().mockResolvedValue(undefined),
  });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('getEnvLlmCatalog', () => {
  test('lists ready providers and playground models', () => {
    const catalog = getEnvLlmCatalog();
    expect(catalog.providers).toEqual([
      { id: 'google', ready: true },
      { id: 'openrouter', ready: true },
    ]);
    expect(catalog.models.some((m) => m.provider === 'google' && m.model === 'gemini-2.5-flash-lite')).toBe(true);
    expect(catalog.models.some((m) => m.provider === 'openrouter' && m.model === 'google/gemini-2.5-flash-lite')).toBe(true);
    expect(catalog.envDefaults.llmProvider).toBe('google');
    expect(catalog.envDefaults.llmModel).toBe('gemini-2.5-flash-lite');
  });

  test('marks provider not ready when keys missing', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const catalog = getEnvLlmCatalog();
    expect(catalog.providers.find((p) => p.id === 'openrouter')?.ready).toBe(false);
  });
});

describe('mergeSelection', () => {
  test('uses env when Firestore empty', () => {
    const catalog = getEnvLlmCatalog();
    const { selection, source } = mergeSelection(null, catalog);
    expect(source).toBe('env');
    expect(selection.aiIntentEnabled).toBe(true);
    expect(selection.llmProvider).toBe('google');
  });

  test('applies valid Firestore primary override', () => {
    const catalog = getEnvLlmCatalog();
    const { selection, source } = mergeSelection({
      aiIntentEnabled: false,
      llmProvider: 'openrouter',
      llmModel: 'google/gemini-2.5-flash-lite',
    }, catalog);
    expect(source).toBe('firestore');
    expect(selection.aiIntentEnabled).toBe(false);
    expect(selection.llmProvider).toBe('openrouter');
    expect(selection.llmModel).toBe('google/gemini-2.5-flash-lite');
  });

  test('ignores unknown Firestore model', () => {
    const catalog = getEnvLlmCatalog();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { selection } = mergeSelection({
      llmProvider: 'google',
      llmModel: 'not-a-real-model',
    }, catalog);
    expect(selection.llmModel).toBe('gemini-2.5-flash-lite');
    warn.mockRestore();
  });
});

describe('getLlmRuntimeSelection', () => {
  test('reads Firestore selection when present', async () => {
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          aiIntentEnabled: true,
          llmProvider: 'openrouter',
          llmModel: 'deepseek/deepseek-v4-flash',
          llmFallbackProvider: 'google',
          llmFallbackModel: 'gemini-2.5-flash-lite',
        }),
      }),
      set: jest.fn(),
    });
    const sel = await getLlmRuntimeSelection({ force: true });
    expect(sel.llmProvider).toBe('openrouter');
    expect(sel.llmModel).toBe('deepseek/deepseek-v4-flash');
    expect(sel.llmFallbackProvider).toBe('google');
    expect(sel.source).toBe('firestore');
  });
});

describe('saveLlmRuntimeSelection', () => {
  test('rejects model not in catalog', async () => {
    const set = jest.fn();
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
      set,
    });
    await expect(saveLlmRuntimeSelection({
      aiIntentEnabled: true,
      llmProvider: 'google',
      llmModel: 'nope',
    })).rejects.toMatchObject({ status: 400 });
    expect(set).not.toHaveBeenCalled();
  });

  test('writes valid selection with merge', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const written = {
      aiIntentEnabled: true,
      llmProvider: 'openrouter',
      llmModel: 'google/gemini-2.5-flash-lite',
      llmFallbackProvider: 'google',
      llmFallbackModel: 'gemini-2.5-flash-lite',
    };
    configRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => written,
      }),
      set,
    });
    const { selection } = await saveLlmRuntimeSelection({
      aiIntentEnabled: true,
      llmProvider: 'openrouter',
      llmModel: 'google/gemini-2.5-flash-lite',
      llmFallbackProvider: 'google',
      llmFallbackModel: 'gemini-2.5-flash-lite',
    });
    expect(set).toHaveBeenCalledWith(written, { merge: true });
    expect(selection.llmFallbackProvider).toBe('google');
  });
});
