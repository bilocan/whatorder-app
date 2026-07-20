/**
 * Runtime LLM selection: env owns the catalog + secrets; Firestore stores
 * admin choices (enable, primary, fallback). See vault notes/admin-ai-config-plan.
 */
const { configRef } = require('./collections');

const CACHE_TTL_MS = 30_000;
const SELECTABLE_PROVIDERS = ['google', 'openrouter'];

/** @type {{ at: number, selection: object|null }} */
let cache = { at: 0, selection: null };

/** @type {{ at: number, stats: object|null }} */
let usageCache = { at: 0, stats: null };

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function llmHelpers() {
  // Lazy require avoids circular load with llm.js
  return require('./llm');
}

function normalizeSelectableProvider(raw) {
  const p = String(raw || '').toLowerCase().trim();
  if (p === 'google' || p === 'openrouter') return p;
  return null;
}

function getEnvDefaults() {
  const {
    getLlmProvider,
    getLlmModel,
    isProviderReady,
  } = llmHelpers();

  // Admin UI only selects google/openrouter; boot env may still use openai.
  const rawProvider = String(getLlmProvider() || 'google').toLowerCase();
  const provider = normalizeSelectableProvider(rawProvider) || rawProvider;
  const model = (getLlmModel() || '').trim();
  const fallbackProvider = normalizeSelectableProvider(process.env.LLM_FALLBACK_PROVIDER);
  const fallbackModel = (process.env.LLM_FALLBACK_MODEL || '').trim() || null;

  return {
    aiIntentEnabled: process.env.AI_INTENT_ENABLED === 'true',
    llmProvider: provider,
    llmModel: model,
    llmFallbackProvider: fallbackProvider && fallbackModel && isProviderReady(fallbackProvider)
      ? fallbackProvider
      : null,
    llmFallbackModel: fallbackProvider && fallbackModel && isProviderReady(fallbackProvider)
      ? fallbackModel
      : null,
  };
}

/**
 * Catalog for admin UI + validation. Never includes secrets.
 */
function getEnvLlmCatalog() {
  const {
    isProviderReady,
    listPlaygroundEntries,
    getLlmProvider,
    getLlmModel,
  } = llmHelpers();

  const providers = SELECTABLE_PROVIDERS.map((id) => ({
    id,
    ready: typeof isProviderReady === 'function' ? isProviderReady(id) : false,
  }));

  const entries = typeof listPlaygroundEntries === 'function' ? listPlaygroundEntries() : [];
  const models = entries
    .filter((e) => SELECTABLE_PROVIDERS.includes(e.provider))
    .map((e) => ({
      label: e.label,
      model: e.model,
      provider: e.provider,
    }));

  // Ensure boot default appears even if not listed in LLM_PLAYGROUND_MODELS
  const envProvider = String(getLlmProvider() || 'google').toLowerCase();
  const envModel = (getLlmModel() || '').trim();
  if (envModel && !models.some((m) => m.provider === envProvider && m.model === envModel)) {
    const label = (envProvider === 'openrouter' || envProvider === 'openai')
      ? `OR ${envModel}`
      : envModel;
    models.unshift({ label, model: envModel, provider: envProvider });
  }

  const envDefaults = getEnvDefaults();
  return {
    providers,
    models,
    envDefaults: {
      aiIntentEnabled: envDefaults.aiIntentEnabled,
      llmProvider: envDefaults.llmProvider,
      llmModel: envDefaults.llmModel,
      llmFallbackProvider: envDefaults.llmFallbackProvider,
      llmFallbackModel: envDefaults.llmFallbackModel,
    },
    ops: {
      timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10),
      retryAttempts: parseInt(process.env.LLM_RETRY_ATTEMPTS || '3', 10),
      rateLimitMs: parseInt(process.env.LLM_RATE_LIMIT_MS || '60000', 10),
      dailyCallCap: parseInt(process.env.LLM_DAILY_CALL_CAP || '5000', 10),
    },
  };
}

function findCatalogModel(catalog, provider, model) {
  if (!provider || !model) return null;
  return catalog.models.find((m) => m.provider === provider && m.model === model) || null;
}

function providerReadyInCatalog(catalog, provider) {
  return Boolean(catalog.providers.find((p) => p.id === provider)?.ready);
}

/**
 * Merge Firestore selection over env. Invalid fields ignored with warning.
 * @returns {{ selection: object, source: 'firestore'|'env'|'mixed', catalog: object }}
 */
function mergeSelection(stored, catalog) {
  const env = catalog.envDefaults;
  let source = 'env';
  const selection = {
    aiIntentEnabled: env.aiIntentEnabled,
    llmProvider: env.llmProvider,
    llmModel: env.llmModel,
    llmFallbackProvider: env.llmFallbackProvider,
    llmFallbackModel: env.llmFallbackModel,
  };

  if (!stored || typeof stored !== 'object') {
    return { selection, source, catalog };
  }

  let usedFirestore = false;

  if (typeof stored.aiIntentEnabled === 'boolean') {
    selection.aiIntentEnabled = stored.aiIntentEnabled;
    usedFirestore = true;
  }

  const storedProvider = normalizeSelectableProvider(stored.llmProvider);
  const storedModel = typeof stored.llmModel === 'string' ? stored.llmModel.trim() : '';
  if (storedProvider && storedModel) {
    if (!providerReadyInCatalog(catalog, storedProvider)) {
      console.warn(`[llm-config] ignoring Firestore primary: provider ${storedProvider} not ready`);
    } else if (!findCatalogModel(catalog, storedProvider, storedModel)) {
      console.warn(`[llm-config] ignoring Firestore primary: model ${storedProvider}/${storedModel} not in env catalog`);
    } else {
      selection.llmProvider = storedProvider;
      selection.llmModel = storedModel;
      usedFirestore = true;
    }
  }

  if (stored.llmFallbackProvider === null || stored.llmFallbackModel === null) {
    selection.llmFallbackProvider = null;
    selection.llmFallbackModel = null;
    usedFirestore = true;
  } else {
    const fbProvider = normalizeSelectableProvider(stored.llmFallbackProvider);
    const fbModel = typeof stored.llmFallbackModel === 'string' ? stored.llmFallbackModel.trim() : '';
    if (fbProvider && fbModel) {
      if (!providerReadyInCatalog(catalog, fbProvider)) {
        console.warn(`[llm-config] ignoring Firestore fallback: provider ${fbProvider} not ready`);
      } else if (!findCatalogModel(catalog, fbProvider, fbModel)) {
        console.warn(`[llm-config] ignoring Firestore fallback: model ${fbProvider}/${fbModel} not in env catalog`);
      } else if (fbProvider === selection.llmProvider && fbModel === selection.llmModel) {
        console.warn('[llm-config] ignoring Firestore fallback: same as primary');
      } else {
        selection.llmFallbackProvider = fbProvider;
        selection.llmFallbackModel = fbModel;
        usedFirestore = true;
      }
    }
  }

  if (usedFirestore) {
    source = (
      typeof stored.aiIntentEnabled === 'boolean'
      || stored.llmProvider
      || stored.llmModel
      || stored.llmFallbackProvider
      || stored.llmFallbackModel
    ) ? 'firestore' : 'env';
    // If only some fields came from Firestore, still label firestore when any applied
    source = 'firestore';
  }

  return { selection, source, catalog };
}

async function readStoredSelection() {
  try {
    const snap = await configRef().get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return {
      aiIntentEnabled: data.aiIntentEnabled,
      llmProvider: data.llmProvider,
      llmModel: data.llmModel,
      llmFallbackProvider: data.llmFallbackProvider,
      llmFallbackModel: data.llmFallbackModel,
    };
  } catch (err) {
    console.warn('[llm-config] Firestore read failed, using env:', err.message);
    return null;
  }
}

function invalidateLlmRuntimeCache() {
  cache = { at: 0, selection: null };
  usageCache = { at: 0, stats: null };
}

/**
 * Persist LLM usage telemetry on config/whatorder (admin config + history).
 * @param {{ provider?: string, model?: string, latencyMs?: number, ok?: boolean, error?: string }} meta
 * - every call → bump UTC daily attempt count + last attempt fields
 * - ok true → provider responded (success for this page); bump success count
 * - ok false → transport/provider error only (timeout, 429, 5xx, network)
 */
async function recordLlmUsage({
  provider, model, latencyMs, ok = true, error = null,
} = {}) {
  const today = utcDay();
  const nowIso = new Date().toISOString();
  const latency = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null;
  const succeeded = ok !== false;

  try {
    const { db } = require('./firebase');
    const ref = configRef();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const sameDay = data.llmDailyDate === today;
      const prevSuccess = sameDay ? (Number(data.llmDailyCalls) || 0) : 0;
      const prevAttemptsRaw = sameDay ? (Number(data.llmDailyAttempts) || 0) : 0;
      // Backfill attempts when older docs only had success counts.
      const prevAttempts = Math.max(prevAttemptsRaw, prevSuccess);
      const nextSuccess = succeeded ? prevSuccess + 1 : prevSuccess;
      const nextAttempts = prevAttempts + 1;

      const updates = {
        llmDailyDate: today,
        llmDailyAttempts: nextAttempts,
        llmLastAttemptAt: nowIso,
        llmLastProvider: provider || null,
        llmLastModel: model || null,
        llmLastLatencyMs: latency,
        llmLastOk: succeeded,
        llmLastError: succeeded ? null : String(error || 'failed').slice(0, 200),
      };
      if (succeeded) {
        updates.llmLastSuccessAt = nowIso;
        updates.llmDailyCalls = nextSuccess;
      }

      tx.set(ref, updates, { merge: true });
      usageCache = {
        at: Date.now(),
        stats: {
          dailyCallCount: nextSuccess,
          dailyAttemptCount: nextAttempts,
          dailyDate: today,
          lastSuccessAt: succeeded
            ? nowIso
            : (typeof data.llmLastSuccessAt === 'string' ? data.llmLastSuccessAt : null),
          lastAttemptAt: nowIso,
          lastOk: succeeded,
          lastError: succeeded ? null : String(error || 'failed').slice(0, 200),
          lastProvider: provider || null,
          lastModel: model || null,
          lastLatencyMs: latency,
        },
      };
    });
    if (process.env.LOG_LEVEL === 'debug' || !succeeded) {
      console.log(
        `[llm-config] usage ${succeeded ? 'ok' : 'fail'} provider=${provider} model=${model}`
        + ` attempts=${usageCache.stats?.dailyAttemptCount} ok=${usageCache.stats?.dailyCallCount}`,
      );
    }
  } catch (err) {
    console.warn('[llm-config] usage persist failed:', err.message);
  }
}

/**
 * Read persisted usage for admin status. Day counter resets at UTC midnight.
 * @param {{ force?: boolean }} [opts]
 */
async function getLlmUsageStats({ force = false } = {}) {
  if (!force && usageCache.stats && (Date.now() - usageCache.at) < CACHE_TTL_MS) {
    return usageCache.stats;
  }

  const empty = {
    dailyCallCount: 0,
    dailyAttemptCount: 0,
    dailyDate: utcDay(),
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastOk: null,
    lastError: null,
    lastProvider: null,
    lastModel: null,
    lastLatencyMs: null,
  };

  try {
    const snap = await configRef().get();
    if (!snap.exists) {
      usageCache = { at: Date.now(), stats: empty };
      return empty;
    }
    const data = snap.data() || {};
    const today = utcDay();
    const sameDay = data.llmDailyDate === today;
    const successes = sameDay ? (Number(data.llmDailyCalls) || 0) : 0;
    // Legacy docs only stored successes; never show attempts < successes.
    const attemptsRaw = sameDay ? (Number(data.llmDailyAttempts) || 0) : 0;
    const stats = {
      dailyCallCount: successes,
      dailyAttemptCount: Math.max(attemptsRaw, successes),
      dailyDate: today,
      lastSuccessAt: typeof data.llmLastSuccessAt === 'string' ? data.llmLastSuccessAt : null,
      lastAttemptAt: typeof data.llmLastAttemptAt === 'string'
        ? data.llmLastAttemptAt
        : (typeof data.llmLastSuccessAt === 'string' ? data.llmLastSuccessAt : null),
      lastOk: typeof data.llmLastOk === 'boolean' ? data.llmLastOk : null,
      lastError: typeof data.llmLastError === 'string' ? data.llmLastError : null,
      lastProvider: typeof data.llmLastProvider === 'string' ? data.llmLastProvider : null,
      lastModel: typeof data.llmLastModel === 'string' ? data.llmLastModel : null,
      lastLatencyMs: Number.isFinite(Number(data.llmLastLatencyMs))
        ? Number(data.llmLastLatencyMs)
        : null,
    };
    usageCache = { at: Date.now(), stats };
    return stats;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[llm-config] usage read failed:', err.message);
    }
    return empty;
  }
}

/**
 * Cached runtime selection for live WhatsApp + gates.
 * @param {{ force?: boolean }} [opts]
 */
async function getLlmRuntimeSelection({ force = false } = {}) {
  if (!force && cache.selection && (Date.now() - cache.at) < CACHE_TTL_MS) {
    return cache.selection;
  }

  const catalog = getEnvLlmCatalog();
  const stored = await readStoredSelection();
  const merged = mergeSelection(stored, catalog);
  const primaryEntry = findCatalogModel(catalog, merged.selection.llmProvider, merged.selection.llmModel);
  const result = {
    ...merged.selection,
    source: merged.source,
    primaryLabel: primaryEntry?.label
      || (merged.selection.llmProvider === 'openrouter'
        ? `OR ${merged.selection.llmModel}`
        : merged.selection.llmModel),
    catalog,
  };
  cache = { at: Date.now(), selection: result };
  return result;
}

/** Sync peek for canCallLlm / isAiIntentEnabled (env until first async refresh). */
function getCachedLlmRuntimeSelection() {
  // Warm Firestore selection in the background so sync gates catch up after admin Save.
  if (!cache.selection || (Date.now() - cache.at) >= CACHE_TTL_MS) {
    getLlmRuntimeSelection().catch(() => {});
  }
  if (cache.selection) return cache.selection;
  const catalog = getEnvLlmCatalog();
  const merged = mergeSelection(null, catalog);
  return {
    ...merged.selection,
    source: 'env',
    primaryLabel: merged.selection.llmProvider === 'openrouter'
      ? `OR ${merged.selection.llmModel}`
      : merged.selection.llmModel,
    catalog,
  };
}

/**
 * Validate + persist admin selection. Only writes selection fields (merge).
 * @returns {{ selection: object, catalog: object }}
 */
async function saveLlmRuntimeSelection(body) {
  const catalog = getEnvLlmCatalog();
  const payload = body && typeof body === 'object' ? body : {};

  if (typeof payload.aiIntentEnabled !== 'boolean') {
    const err = new Error('aiIntentEnabled (boolean) is required');
    err.status = 400;
    throw err;
  }

  const provider = normalizeSelectableProvider(payload.llmProvider);
  const model = typeof payload.llmModel === 'string' ? payload.llmModel.trim() : '';
  if (!provider || !model) {
    const err = new Error('llmProvider and llmModel are required');
    err.status = 400;
    throw err;
  }
  if (!providerReadyInCatalog(catalog, provider)) {
    const err = new Error(`Provider ${provider} is not ready (missing env keys)`);
    err.status = 400;
    throw err;
  }
  if (!findCatalogModel(catalog, provider, model)) {
    const err = new Error(`Model ${model} is not in the env catalog for ${provider}`);
    err.status = 400;
    throw err;
  }

  let fallbackProvider = null;
  let fallbackModel = null;
  const clearFallback = payload.llmFallbackProvider === null
    || payload.llmFallbackModel === null
    || payload.llmFallbackProvider === ''
    || payload.llmFallbackModel === '';

  if (!clearFallback && (payload.llmFallbackProvider || payload.llmFallbackModel)) {
    fallbackProvider = normalizeSelectableProvider(payload.llmFallbackProvider);
    fallbackModel = typeof payload.llmFallbackModel === 'string' ? payload.llmFallbackModel.trim() : '';
    if (!fallbackProvider || !fallbackModel) {
      const err = new Error('Fallback requires both llmFallbackProvider and llmFallbackModel, or both null');
      err.status = 400;
      throw err;
    }
    if (!providerReadyInCatalog(catalog, fallbackProvider)) {
      const err = new Error(`Fallback provider ${fallbackProvider} is not ready`);
      err.status = 400;
      throw err;
    }
    if (!findCatalogModel(catalog, fallbackProvider, fallbackModel)) {
      const err = new Error(`Fallback model ${fallbackModel} is not in the env catalog for ${fallbackProvider}`);
      err.status = 400;
      throw err;
    }
    if (fallbackProvider === provider && fallbackModel === model) {
      const err = new Error('Fallback cannot match primary provider/model');
      err.status = 400;
      throw err;
    }
  }

  const toWrite = {
    aiIntentEnabled: payload.aiIntentEnabled,
    llmProvider: provider,
    llmModel: model,
    llmFallbackProvider: fallbackProvider,
    llmFallbackModel: fallbackModel,
  };

  await configRef().set(toWrite, { merge: true });
  invalidateLlmRuntimeCache();
  const selection = await getLlmRuntimeSelection({ force: true });
  return { selection, catalog };
}

function getAdminLlmConfigPayload(selection, usageStats) {
  const dailyCallCap = selection.catalog.ops.dailyCallCap;
  return {
    catalog: {
      providers: selection.catalog.providers,
      models: selection.catalog.models,
      envDefaults: selection.catalog.envDefaults,
      ops: selection.catalog.ops,
    },
    selection: {
      aiIntentEnabled: selection.aiIntentEnabled,
      llmProvider: selection.llmProvider,
      llmModel: selection.llmModel,
      llmFallbackProvider: selection.llmFallbackProvider,
      llmFallbackModel: selection.llmFallbackModel,
    },
    status: {
      source: selection.source,
      primaryLabel: selection.primaryLabel,
      primaryReady: providerReadyInCatalog(selection.catalog, selection.llmProvider),
      fallbackConfigured: Boolean(selection.llmFallbackProvider && selection.llmFallbackModel),
      dailyCallCount: usageStats?.dailyCallCount ?? 0,
      dailyAttemptCount: usageStats?.dailyAttemptCount ?? 0,
      dailyCallCap,
      dailyDate: usageStats?.dailyDate ?? null,
      lastSuccessAt: usageStats?.lastSuccessAt ?? null,
      lastAttemptAt: usageStats?.lastAttemptAt ?? null,
      lastOk: usageStats?.lastOk ?? null,
      lastError: usageStats?.lastError ?? null,
      lastProvider: usageStats?.lastProvider ?? null,
      lastModel: usageStats?.lastModel ?? null,
      lastLatencyMs: usageStats?.lastLatencyMs ?? null,
    },
  };
}

module.exports = {
  CACHE_TTL_MS,
  SELECTABLE_PROVIDERS,
  getEnvLlmCatalog,
  getEnvDefaults,
  getLlmRuntimeSelection,
  getCachedLlmRuntimeSelection,
  saveLlmRuntimeSelection,
  invalidateLlmRuntimeCache,
  getAdminLlmConfigPayload,
  recordLlmUsage,
  getLlmUsageStats,
  mergeSelection,
  findCatalogModel,
  normalizeSelectableProvider,
  utcDay,
};
