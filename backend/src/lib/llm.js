const axios = require('axios');
const { buildMenuLlmIndex, resolveMenuLlmItems } = require('./menuLlmIndex');
const { repairMenuLlmRawItems } = require('./menuLlmRepair');

const OPENAI_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: ['number', 'null'] },
        },
        required: ['name'],
      },
    },
    partySize: { type: ['number', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['items', 'confidence'],
};

/** Gemini responseSchema: no union types; use nullable instead. */
const GEMINI_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'integer', nullable: true },
        },
        required: ['name'],
      },
    },
    partySize: { type: 'integer', nullable: true },
    confidence: { type: 'number' },
  },
  required: ['items', 'confidence'],
};

const SYSTEM_PROMPT = `You extract food/drink order intent from WhatsApp messages (English, German, Turkish).
Return JSON only. Rules:
- items: food/drink names as the customer wrote them (never invent menu IDs or prices).
- qty: per-item quantity when explicit ("2 pizza" → 2); null if not stated for that item.
- partySize: from "for 2", "2 personen", "iki kişi", etc.; null if absent.
- confidence: 0.0–1.0. Use <0.6 for greetings, recommendations ("was empfehlt ihr"), or unclear requests.
- Never output restaurant names, prices, or item IDs.
- Split combined orders: "chicken döner with extra sauce and a cola" → separate items.
- Austria pizza: standard size is ~33 cm but customers never say that; large = Familienpizza. Map typos (Margarita→Margherita, spinati→Spinaci).
- German "Eine Pizza X und eine Y" → two separate items with qty 1 each.`;

const MENU_CONSTRAINED_SYSTEM_PROMPT = `You extract food/drink order intent from WhatsApp messages (English, German, Turkish).
The customer orders ONLY from the restaurant menu provided. Return JSON only.

Rules:
- items[].menuItemId: MUST be an id from the menu list — never invent ids or items.
- items[].lineText: optional customer phrasing for that line (modifiers: mit allem, ohne zwiebel, scharf). Use when spoken text differs from the menu name.
- items[].qty: per-line quantity when explicit; null if not stated for that line.
- partySize: from "for 2", "2 personen", "iki kişi", etc.; null if absent.
- confidence: 0.0–1.0. Use <0.6 for greetings, recommendations, or unclear requests.
- Split combined orders into separate items only when the customer names distinct dishes or drinks.
- Do NOT split on "und" when it links modifiers to the previous dish (e.g. "kebab mit allem und scharf" = ONE item).
- "Schaf" after food is a TTS typo for spicy (scharf), NOT Schafskäse — keep it in lineText on the kebab/döner line, never as a separate wrap item.
- Drink TTS typos: Eiern/Eimer/einem → Ayran when on menu; never map orphan tokens to unrelated drinks.
- Map other voice typos to the closest menu item (Margarita→Margherita).
- Austria pizza: large size is Familienpizza when on menu.`;

const OPENAI_MENU_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          menuItemId: { type: 'string' },
          qty: { type: ['number', 'null'] },
          lineText: { type: ['string', 'null'] },
        },
        required: ['menuItemId'],
      },
    },
    partySize: { type: ['number', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['items', 'confidence'],
};

const GEMINI_MENU_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          menuItemId: { type: 'string' },
          qty: { type: 'integer', nullable: true },
          lineText: { type: 'string', nullable: true },
        },
        required: ['menuItemId'],
      },
    },
    partySize: { type: 'integer', nullable: true },
    confidence: { type: 'number' },
  },
  required: ['items', 'confidence'],
};

const EDIT_SYSTEM_PROMPT = `You interpret WhatsApp messages that EDIT an existing food order proposal (not a new order).
Return JSON only. The user message includes the current proposed order lines and the customer's edit text.

Actions (type field):
- remove: drop item(s) from the order. Turkish often uses suffix: "pizza çıkar" / "ayran cikar" = remove pizza / remove ayran.
  German: "ohne döner", "pizza weg". English: "remove ayran", "no cola".
- add: add items (fragment = what to add, e.g. "1 cola").
- set_qty: change quantity of one existing line (name + qty).
- replace: customer sends a full new order (fragment = full order text).
- cancel: abandon the proposal.
- none: unclear or unrelated (confidence < 0.6).

Rules:
- rawName: dish keyword to remove or change qty — use the customer's word (pizza, ayran, döner), not a menu SKU.
- Never invent menu IDs or prices.
- confidence: 0.0–1.0; use <0.6 when unsure.`;

const OPENAI_EDIT_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['remove', 'add', 'set_qty', 'replace', 'cancel', 'none'],
    },
    rawName: { type: ['string', 'null'] },
    fragment: { type: ['string', 'null'] },
    qty: { type: ['number', 'null'] },
    confidence: { type: 'number' },
  },
  required: ['type', 'confidence'],
};

const GEMINI_EDIT_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['remove', 'add', 'set_qty', 'replace', 'cancel', 'none'],
    },
    rawName: { type: 'string', nullable: true },
    fragment: { type: 'string', nullable: true },
    qty: { type: 'integer', nullable: true },
    confidence: { type: 'number' },
  },
  required: ['type', 'confidence'],
};

/** Bot navigation commands — NOT order intent. Never pass menu or menuItemId here. */
const COMMAND_SYSTEM_PROMPT = `You classify short WhatsApp messages to a food ordering bot (German, English, Turkish).
This is NOT food ordering. Do NOT extract dishes, drinks, menuItemId, quantities, or prices.
Return JSON only with fields: command, confidence.

command must be one of:
- view_basket: customer wants to see their cart (warenkorb, show basket, was hab ich, sepeti göster, zeig mal den warenkorb)
- undo: revert the last cart change (rückgängig, undo, geri al, zurück ONLY when undo is available in context)
- none: food orders, menu item names, greetings, search, checkout steps, or anything else

Rules:
- Single dish/drink names or order phrasing ("2 döner", "cola dazu") → none (handled by a separate order parser).
- Use undo only when context says undo is available AND the message clearly means revert/undo, not "go back to menu".
- confidence: 0.0–1.0; use <0.85 when unsure.`;

const OPENAI_COMMAND_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      enum: ['view_basket', 'undo', 'none'],
    },
    confidence: { type: 'number' },
  },
  required: ['command', 'confidence'],
};

const GEMINI_COMMAND_SCHEMA = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      enum: ['view_basket', 'undo', 'none'],
    },
    confidence: { type: 'number' },
  },
  required: ['command', 'confidence'],
};

const rateLimitByPhone = new Map();
let dailyCallCount = 0;
let dailyCallDate = '';

function getLlmProvider() {
  return (process.env.LLM_PROVIDER || 'google').toLowerCase();
}

function normalizeProvider(provider) {
  return String(provider || getLlmProvider()).toLowerCase();
}

/** OpenAI Chat Completions API, including OpenRouter's compatible endpoint. */
function usesOpenAiCompatibleProvider(provider) {
  const p = normalizeProvider(provider);
  return p === 'openai' || p === 'openrouter';
}

function getOpenAiCompatibleApiKey(provider) {
  const p = normalizeProvider(provider);
  if (p === 'openrouter') {
    return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
  }
  return process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || '';
}

/** Required for openai / openrouter. Example: https://openrouter.ai/api/v1 */
function getOpenAiCompatibleBaseUrl(provider) {
  const p = normalizeProvider(provider);
  const raw = p === 'openrouter'
    ? (process.env.OPENROUTER_BASE_URL || process.env.OPENAI_BASE_URL || '')
    : (process.env.OPENAI_BASE_URL || process.env.OPENROUTER_BASE_URL || '');
  return raw.replace(/\/$/, '');
}

/** Required whenever AI intent is enabled. No in-code model defaults. */
function getLlmModel() {
  return (process.env.LLM_MODEL || '').trim();
}

/**
 * Gemini generateContent base (no trailing slash).
 * Example: https://generativelanguage.googleapis.com/v1beta
 */
function getGeminiApiBaseUrl() {
  const raw = process.env.GEMINI_API_BASE_URL || '';
  return raw.replace(/\/$/, '');
}

function isProviderReady(provider) {
  const p = normalizeProvider(provider);
  if (usesOpenAiCompatibleProvider(p)) {
    return Boolean(getOpenAiCompatibleApiKey(p) && getOpenAiCompatibleBaseUrl(p));
  }
  return Boolean(process.env.GEMINI_API_KEY && getGeminiApiBaseUrl());
}

/**
 * Resolve chat-completions URL + headers for openai / openrouter.
 * All host / key / model / optional ranking headers come from env.
 */
function getOpenAiCompatibleClient({ model: modelOverride, provider: providerOverride } = {}) {
  const provider = normalizeProvider(providerOverride);
  const baseUrl = getOpenAiCompatibleBaseUrl(provider);
  const apiKey = getOpenAiCompatibleApiKey(provider);
  const model = (modelOverride || getLlmModel()).trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      '[llm] openai-compatible provider requires OPENAI_BASE_URL (or OPENROUTER_BASE_URL), '
      + 'OPENAI_API_KEY (or OPENROUTER_API_KEY), and LLM_MODEL',
    );
  }
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER || process.env.LLM_HTTP_REFERER;
  const title = process.env.OPENROUTER_APP_TITLE || process.env.LLM_APP_TITLE;
  if (referer) headers['HTTP-Referer'] = referer;
  if (title) headers['X-Title'] = title;
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    model,
  };
}

function getGeminiGenerateContentUrl(model) {
  const baseUrl = getGeminiApiBaseUrl();
  if (!baseUrl) {
    throw new Error('[llm] google provider requires GEMINI_API_BASE_URL');
  }
  if (!model) {
    throw new Error('[llm] google provider requires LLM_MODEL');
  }
  return `${baseUrl}/models/${model}:generateContent`;
}

function isAiIntentEnabled() {
  const { getCachedLlmRuntimeSelection } = require('./llmRuntimeConfig');
  const runtime = getCachedLlmRuntimeSelection();
  if (!runtime.aiIntentEnabled) return false;
  if (!runtime.llmModel) return false;
  return isProviderReady(runtime.llmProvider);
}

/**
 * Parse a Teach-bot / playground model entry.
 * - `OR:google/gemini-2.5-flash-lite` or `OR google/...` → OpenRouter
 * - bare `gemini-2.5-flash-lite` → direct Google Gemini
 * - bare `vendor/model` (has `/`) → OpenRouter, label normalized to `OR …`
 */
function parsePlaygroundModelEntry(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const orMatch = trimmed.match(/^OR[:\s]+(.+)$/i);
  if (orMatch) {
    const model = orMatch[1].trim();
    if (!model) return null;
    return { label: `OR ${model}`, model, provider: 'openrouter' };
  }

  const directMatch = trimmed.match(/^(DIRECT|GEMINI)[:\s]+(.+)$/i);
  if (directMatch) {
    const model = directMatch[2].trim();
    if (!model) return null;
    return { label: model, model, provider: 'google' };
  }

  if (trimmed.includes('/')) {
    return { label: `OR ${trimmed}`, model: trimmed, provider: 'openrouter' };
  }

  return { label: trimmed, model: trimmed, provider: 'google' };
}

function defaultPlaygroundEntry() {
  const model = getLlmModel();
  if (!model) return null;
  if (usesOpenAiCompatibleProvider()) {
    return parsePlaygroundModelEntry(`OR:${model}`);
  }
  return parsePlaygroundModelEntry(model);
}

/**
 * Models selectable in Teach bot / playground (display labels).
 * Always includes env default; extras from LLM_PLAYGROUND_MODELS (comma-separated).
 */
function listPlaygroundEntries() {
  const entries = [];
  const seen = new Set();
  const add = (raw) => {
    const entry = typeof raw === 'object' && raw?.label
      ? raw
      : parsePlaygroundModelEntry(raw);
    if (!entry || seen.has(entry.label)) return;
    seen.add(entry.label);
    entries.push(entry);
  };
  add(defaultPlaygroundEntry());
  for (const part of String(process.env.LLM_PLAYGROUND_MODELS || '').split(',')) {
    add(part);
  }
  return entries;
}

function listPlaygroundModels() {
  return listPlaygroundEntries().map((e) => e.label);
}

/**
 * Resolve optional playground override. Empty → env default entry.
 * Unknown label → null (caller should 400).
 * @returns {{ label: string, model: string, provider: string }|null}
 */
function resolvePlaygroundModel(requested) {
  const entries = listPlaygroundEntries();
  if (!entries.length) return null;
  const trimmed = String(requested ?? '').trim();
  if (!trimmed) return entries[0];

  const exact = entries.find((e) => e.label === trimmed);
  if (exact) return exact;

  // Accept raw env forms (OR:slug, bare slug) that normalize to a listed label.
  const parsed = parsePlaygroundModelEntry(trimmed);
  if (!parsed) return null;
  return entries.find((e) => e.label === parsed.label) || null;
}

function getPlaygroundLlmConfig() {
  const entries = listPlaygroundEntries();
  return {
    provider: getLlmProvider(),
    defaultModel: entries[0]?.label || null,
    models: entries.map((e) => e.label),
  };
}

function resetDailyCapIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyCallDate !== today) {
    dailyCallDate = today;
    dailyCallCount = 0;
  }
}

function isWithinDailyCap() {
  resetDailyCapIfNeeded();
  const cap = parseInt(process.env.LLM_DAILY_CALL_CAP || '5000', 10);
  return dailyCallCount < cap;
}

function isWithinRateLimit(phone) {
  if (!phone) return true;
  const cooldownMs = parseInt(process.env.LLM_RATE_LIMIT_MS || '60000', 10);
  const last = rateLimitByPhone.get(phone);
  if (!last) return true;
  return Date.now() - last >= cooldownMs;
}

function recordCall(phone, { provider, model, latencyMs } = {}) {
  resetDailyCapIfNeeded();
  dailyCallCount += 1;
  if (phone) rateLimitByPhone.set(phone, Date.now());
}

/**
 * Memory rate/cap + Firestore last-used / daily count.
 * ok=true when the provider responded (config/history). Soft intent-parse
 * misses still count as ok; only transport/provider errors are failures.
 */
async function recordCallAndPersist(phone, meta = {}) {
  const ok = meta.ok !== false;
  if (ok) recordCall(phone, meta);
  const { recordLlmUsage } = require('./llmRuntimeConfig');
  await recordLlmUsage({ ...meta, ok });
}

function canCallLlm(phone, { provider } = {}) {
  const { getCachedLlmRuntimeSelection } = require('./llmRuntimeConfig');
  const runtime = getCachedLlmRuntimeSelection();
  if (!runtime.aiIntentEnabled) return false;
  const resolved = provider || runtime.llmProvider || getLlmProvider();
  if (!isProviderReady(resolved)) return false;
  return isWithinDailyCap() && isWithinRateLimit(phone);
}

function getDailyCallStats() {
  resetDailyCapIfNeeded();
  return {
    dailyCallCount,
    dailyCallCap: parseInt(process.env.LLM_DAILY_CALL_CAP || '5000', 10),
  };
}

/**
 * Resolve live primary (+ optional fallback) from admin/env selection.
 * Explicit playground overrides skip runtime primary/fallback.
 */
async function resolveLiveLlmTargets({ model, provider, llmLabel } = {}) {
  if (model || provider) {
    const resolvedProvider = normalizeProvider(provider);
    const resolvedModel = (model || getLlmModel()).trim();
    return {
      primary: {
        provider: resolvedProvider,
        model: resolvedModel,
        llmLabel: llmLabel || undefined,
      },
      fallback: null,
    };
  }

  const { getLlmRuntimeSelection } = require('./llmRuntimeConfig');
  const runtime = await getLlmRuntimeSelection();
  if (!runtime.aiIntentEnabled || !runtime.llmModel) {
    return { primary: null, fallback: null };
  }

  const primary = {
    provider: normalizeProvider(runtime.llmProvider),
    model: runtime.llmModel,
    llmLabel: runtime.primaryLabel,
  };
  let fallback = null;
  if (
    runtime.llmFallbackProvider
    && runtime.llmFallbackModel
    && isProviderReady(runtime.llmFallbackProvider)
  ) {
    fallback = {
      provider: normalizeProvider(runtime.llmFallbackProvider),
      model: runtime.llmFallbackModel,
      llmLabel: runtime.llmFallbackProvider === 'openrouter'
        ? `OR ${runtime.llmFallbackModel}`
        : runtime.llmFallbackModel,
    };
  }
  return { primary, fallback };
}

const RETRYABLE_STATUSES = new Set([429, 500, 503, 504]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableLlmError(err) {
  const status = err.response?.status;
  return RETRYABLE_STATUSES.has(status);
}

/** Retry transient Gemini/OpenAI overload errors (503 high demand, etc.). */
async function withLlmRetry(fn) {
  const maxAttempts = parseInt(process.env.LLM_RETRY_ATTEMPTS || '3', 10);
  const baseDelayMs = parseInt(process.env.LLM_RETRY_DELAY_MS || '1000', 10);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableLlmError(err)) throw err;
      const delay = baseDelayMs * attempt;
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`[llm] retry ${attempt}/${maxAttempts - 1} after ${err.response?.status} in ${delay}ms`);
      }
      await sleep(delay);
    }
  }
  throw lastErr;
}

function parseJsonContent(raw) {
  if (raw == null) return null;
  let text = raw;
  if (Array.isArray(raw)) {
    text = raw.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
  }
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function validateIntentPayload(data) {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.items)) return null;
  const confidence = Number(
    data.confidence ?? data.overall_confidence ?? data.overallConfidence,
  );
  if (!Number.isFinite(confidence)) return null;

  const items = data.items
    .filter(i => i && typeof i.name === 'string' && i.name.trim())
    .map(i => {
      const rawQty = i.qty ?? i.quantity;
      return {
        name: i.name.trim(),
        qty: rawQty == null ? null : Math.min(99, Math.max(1, Number(rawQty) || 1)),
      };
    });

  let partySize = null;
  if (data.partySize != null) {
    const n = parseInt(data.partySize, 10);
    if (n > 0 && n <= 99) partySize = n;
  }

  return { items, partySize, confidence: Math.max(0, Math.min(1, confidence)) };
}

function validateMenuIntentPayload(data, menuIndex) {
  if (!data || typeof data !== 'object' || !menuIndex?.byId) return null;
  const confidence = Number(
    data.confidence ?? data.overall_confidence ?? data.overallConfidence,
  );
  if (!Number.isFinite(confidence)) return null;

  const rawItems = repairMenuLlmRawItems(
    (data.items ?? []).filter(i => i && typeof i.menuItemId === 'string' && i.menuItemId.trim()),
    menuIndex,
  );

  const items = resolveMenuLlmItems(rawItems, menuIndex);
  if (!items.length) return null;

  let partySize = null;
  if (data.partySize != null) {
    const n = parseInt(data.partySize, 10);
    if (n > 0 && n <= 99) partySize = n;
  }

  return {
    items,
    partySize,
    confidence: Math.max(0, Math.min(1, confidence)),
    menuConstrained: true,
  };
}

function interpretIntentPayload(content, { constrained = false, menuIndex = null } = {}) {
  if (content == null || (typeof content === 'string' && !content.trim())
    || (Array.isArray(content) && content.length === 0)) {
    return { result: null, error: 'empty_response' };
  }
  const parsed = parseJsonContent(content);
  if (!parsed) return { result: null, error: 'invalid_json' };

  if (constrained) {
    const menuResult = validateMenuIntentPayload(parsed, menuIndex);
    if (menuResult) return { result: menuResult, error: null };

    // Some OpenRouter models ignore menuItemId and return free-form names.
    const free = validateIntentPayload(parsed);
    if (free?.items?.length) return { result: free, error: null };

    // Or return lineText / name without resolvable ids — still usable for menu match.
    const fromLines = (parsed.items ?? [])
      .map((i) => {
        if (!i || typeof i !== 'object') return null;
        const name = (typeof i.name === 'string' && i.name.trim())
          || (typeof i.lineText === 'string' && i.lineText.trim())
          || '';
        if (!name) return null;
        const rawQty = i.qty ?? i.quantity;
        return {
          name,
          qty: rawQty == null ? null : Math.min(99, Math.max(1, Number(rawQty) || 1)),
        };
      })
      .filter(Boolean);
    const confidence = Number(
      parsed.confidence ?? parsed.overall_confidence ?? parsed.overallConfidence,
    );
    if (fromLines.length && Number.isFinite(confidence)) {
      return {
        result: {
          items: fromLines,
          partySize: null,
          confidence: Math.max(0, Math.min(1, confidence)),
        },
        error: null,
      };
    }

    return { result: null, error: 'no_menu_match' };
  }

  const result = validateIntentPayload(parsed);
  if (!result) return { result: null, error: 'invalid_schema' };
  return { result, error: null };
}

function buildMenuConstrainedUserText(userText, menuIndex) {
  let block = `Restaurant menu (${menuIndex.count} items):\n${menuIndex.promptBlock}`;
  if (menuIndex.truncated) {
    block += '\n(note: menu truncated for length)';
  }
  return `${block}\n\nCustomer message:\n${userText}`;
}

function validateEditPayload(data) {
  if (!data || typeof data !== 'object') return null;
  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) return null;
  const type = data.type;
  const allowed = new Set(['remove', 'add', 'set_qty', 'replace', 'cancel', 'none']);
  if (!allowed.has(type)) return null;
  if (confidence < 0.6 || type === 'none') return null;

  const base = {
    type,
    confidence: Math.max(0, Math.min(1, confidence)),
  };

  if (type === 'remove') {
    const rawName = typeof data.rawName === 'string' ? data.rawName.trim() : '';
    if (!rawName) return null;
    return { ...base, rawName };
  }
  if (type === 'add' || type === 'replace') {
    const fragment = typeof data.fragment === 'string' ? data.fragment.trim() : '';
    if (!fragment) return null;
    return { ...base, fragment };
  }
  if (type === 'set_qty') {
    const name = typeof data.rawName === 'string' ? data.rawName.trim() : '';
    const qty = Math.min(99, Math.max(1, parseInt(data.qty, 10) || 1));
    if (!name) return null;
    return { ...base, name, qty };
  }
  if (type === 'cancel') return base;
  return null;
}

function validateCommandPayload(data) {
  if (!data || typeof data !== 'object') return null;
  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) return null;
  const command = String(data.command ?? '').toLowerCase();
  const allowed = new Set(['view_basket', 'undo', 'none']);
  if (!allowed.has(command)) return null;
  return {
    command,
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

function buildCommandUserText(text, { hasUndoSnapshot = false, hasBasket = false } = {}) {
  const lines = [
    `Basket has items: ${hasBasket ? 'yes' : 'no'}`,
    `Undo available: ${hasUndoSnapshot ? 'yes' : 'no'}`,
    '',
    `Customer message:\n${text}`,
  ];
  return lines.join('\n');
}

async function callOpenAiCommand(userText, { model, provider } = {}) {
  const client = getOpenAiCompatibleClient({ model, provider });
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);

  const res = await axios.post(
    client.url,
    {
      model: client.model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'bot_command',
          strict: true,
          schema: OPENAI_COMMAND_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: COMMAND_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    },
    {
      headers: client.headers,
      timeout,
    },
  );

  const content = res.data?.choices?.[0]?.message?.content;
  return validateCommandPayload(parseJsonContent(content));
}

async function callGeminiCommand(userText, { model } = {}) {
  const resolvedModel = (model || getLlmModel()).trim();
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const url = getGeminiGenerateContentUrl(resolvedModel);
  const key = process.env.GEMINI_API_KEY;

  const baseBody = {
    systemInstruction: { parts: [{ text: COMMAND_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0 },
  };

  const withSchema = {
    ...baseBody,
    generationConfig: {
      ...baseBody.generationConfig,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_COMMAND_SCHEMA,
    },
  };

  try {
    const res = await withLlmRetry(() => axios.post(url, withSchema, {
      params: { key },
      headers: { 'Content-Type': 'application/json' },
      timeout,
    }));
    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = validateCommandPayload(parseJsonContent(content));
    if (parsed) return parsed;
  } catch (err) {
    const status = err.response?.status;
    if (status === 400) {
      try {
        const res = await withLlmRetry(() => axios.post(url, {
          ...baseBody,
          generationConfig: {
            ...baseBody.generationConfig,
            responseMimeType: 'application/json',
          },
        }, {
          params: { key },
          headers: { 'Content-Type': 'application/json' },
          timeout,
        }));
        const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = validateCommandPayload(parseJsonContent(content));
        if (parsed) return parsed;
      } catch (retryErr) {
        throw retryErr;
      }
    }
    throw err;
  }

  return null;
}

async function invokeCommandParse(userText, { provider, model }) {
  return usesOpenAiCompatibleProvider(provider)
    ? callOpenAiCommand(userText, { model, provider })
    : callGeminiCommand(userText, { model });
}

async function parseBotCommandWithLlm(text, { phone, hasUndoSnapshot = false, hasBasket = false } = {}) {
  const { primary, fallback } = await resolveLiveLlmTargets();
  if (!primary || !canCallLlm(phone, { provider: primary.provider })) return null;

  const userText = buildCommandUserText(text, { hasUndoSnapshot, hasBasket });
  const started = Date.now();
  const targets = [primary];
  if (fallback) targets.push(fallback);

  let lastErr = null;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (!isProviderReady(target.provider)) continue;
    try {
      const result = await invokeCommandParse(userText, target);
      if (result) {
        await recordCallAndPersist(phone, {
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - started,
          ok: true,
        });
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`[llm] bot command parsed via ${target.provider}/${target.model} in ${Date.now() - started}ms command=${result.command} confidence=${result.confidence}`);
        }
        return result;
      }
      await recordCallAndPersist(phone, {
        provider: target.provider,
        model: target.model,
        latencyMs: Date.now() - started,
        ok: true,
      });
      return null;
    } catch (err) {
      lastErr = err;
      logLlmFailure(err, err.response?.data?.error?.message);
      const canFallback = i === 0 && fallback && isRetryableLlmError(err);
      if (!canFallback) {
        await recordCallAndPersist(phone, {
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - started,
          ok: false,
          error: err.response?.data?.error?.message || err.message || String(err.response?.status || 'error'),
        });
        return null;
      }
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[llm] primary command failed; trying fallback ${fallback.provider}/${fallback.model}`);
      }
    }
  }
  if (lastErr) return null;
  return null;
}

async function callOpenAiEdit(userText, { model, provider } = {}) {
  const client = getOpenAiCompatibleClient({ model, provider });
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);

  const res = await axios.post(
    client.url,
    {
      model: client.model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'proposal_edit',
          strict: true,
          schema: OPENAI_EDIT_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: EDIT_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    },
    {
      headers: client.headers,
      timeout,
    },
  );

  const content = res.data?.choices?.[0]?.message?.content;
  return validateEditPayload(parseJsonContent(content));
}

async function callGeminiEdit(userText, { model } = {}) {
  const resolvedModel = (model || getLlmModel()).trim();
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const url = getGeminiGenerateContentUrl(resolvedModel);
  const key = process.env.GEMINI_API_KEY;

  const baseBody = {
    systemInstruction: { parts: [{ text: EDIT_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0 },
  };

  const withSchema = {
    ...baseBody,
    generationConfig: {
      ...baseBody.generationConfig,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_EDIT_SCHEMA,
    },
  };

  try {
    const res = await withLlmRetry(() => axios.post(url, withSchema, {
      params: { key },
      headers: { 'Content-Type': 'application/json' },
      timeout,
    }));
    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = validateEditPayload(parseJsonContent(content));
    if (parsed) return parsed;
  } catch (err) {
    const status = err.response?.status;
    if (status === 400) {
      try {
        const res = await withLlmRetry(() => axios.post(url, {
          ...baseBody,
          generationConfig: {
            ...baseBody.generationConfig,
            responseMimeType: 'application/json',
          },
        }, {
          params: { key },
          headers: { 'Content-Type': 'application/json' },
          timeout,
        }));
        const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = validateEditPayload(parseJsonContent(content));
        if (parsed) return parsed;
      } catch (retryErr) {
        throw retryErr;
      }
    }
    throw err;
  }

  return null;
}

async function invokeEditParse(userText, { provider, model }) {
  return usesOpenAiCompatibleProvider(provider)
    ? callOpenAiEdit(userText, { model, provider })
    : callGeminiEdit(userText, { model });
}

async function parseProposalEditWithLlm(text, pendingItems, { phone } = {}) {
  const { primary, fallback } = await resolveLiveLlmTargets();
  if (!primary || !canCallLlm(phone, { provider: primary.provider })) return null;

  const orderLines = (pendingItems ?? [])
    .map(p => `${p.qty}x ${p.name}`)
    .join('\n');
  const userText = `Current proposed order:\n${orderLines}\n\nCustomer edit:\n${text}`;

  const started = Date.now();
  const targets = [primary];
  if (fallback) targets.push(fallback);

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (!isProviderReady(target.provider)) continue;
    try {
      const result = await invokeEditParse(userText, target);
      if (result) {
        await recordCallAndPersist(phone, {
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - started,
          ok: true,
        });
        if (process.env.LOG_LEVEL === 'debug') {
          console.log(`[llm] proposal edit parsed via ${target.provider}/${target.model} in ${Date.now() - started}ms type=${result.type} confidence=${result.confidence}`);
        }
        return result;
      }
      await recordCallAndPersist(phone, {
        provider: target.provider,
        model: target.model,
        latencyMs: Date.now() - started,
        ok: true,
      });
      return null;
    } catch (err) {
      logLlmFailure(err, err.response?.data?.error?.message);
      const canFallback = i === 0 && fallback && isRetryableLlmError(err);
      if (!canFallback) {
        await recordCallAndPersist(phone, {
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - started,
          ok: false,
          error: err.response?.data?.error?.message || err.message || String(err.response?.status || 'error'),
        });
        return null;
      }
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[llm] primary edit failed; trying fallback ${fallback.provider}/${fallback.model}`);
      }
    }
  }
  return null;
}

async function callOpenAi(userText, { menuIndex = null, model, provider } = {}) {
  const client = getOpenAiCompatibleClient({ model, provider });
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const constrained = !!menuIndex?.byId?.size;
  const systemPrompt = constrained ? MENU_CONSTRAINED_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const schema = constrained ? OPENAI_MENU_INTENT_SCHEMA : OPENAI_INTENT_SCHEMA;
  const promptText = constrained ? buildMenuConstrainedUserText(userText, menuIndex) : userText;

  const res = await axios.post(
    client.url,
    {
      model: client.model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: constrained ? 'menu_order_intent' : 'order_intent',
          strict: true,
          schema,
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: promptText },
      ],
    },
    {
      headers: client.headers,
      timeout,
    },
  );

  const content = res.data?.choices?.[0]?.message?.content;
  return interpretIntentPayload(content, { constrained, menuIndex });
}

async function callGemini(userText, { menuIndex = null, model } = {}) {
  const resolvedModel = (model || getLlmModel()).trim();
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const url = getGeminiGenerateContentUrl(resolvedModel);
  const key = process.env.GEMINI_API_KEY;
  const constrained = !!menuIndex?.byId?.size;
  const systemPrompt = constrained ? MENU_CONSTRAINED_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const responseSchema = constrained ? GEMINI_MENU_INTENT_SCHEMA : GEMINI_INTENT_SCHEMA;
  const promptText = constrained ? buildMenuConstrainedUserText(userText, menuIndex) : userText;

  const baseBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: { temperature: 0 },
  };

  const withSchema = {
    ...baseBody,
    generationConfig: {
      ...baseBody.generationConfig,
      responseMimeType: 'application/json',
      responseSchema,
    },
  };

  try {
    const res = await withLlmRetry(() => axios.post(url, withSchema, {
      params: { key },
      headers: { 'Content-Type': 'application/json' },
      timeout,
    }));
    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return interpretIntentPayload(content, { constrained, menuIndex });
  } catch (err) {
    const status = err.response?.status;
    if (status === 400) {
      // Schema rejected — retry JSON mode without strict schema.
      try {
        const res = await withLlmRetry(() => axios.post(url, {
          ...baseBody,
          generationConfig: {
            ...baseBody.generationConfig,
            responseMimeType: 'application/json',
          },
        }, {
          params: { key },
          headers: { 'Content-Type': 'application/json' },
          timeout,
        }));
        const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return interpretIntentPayload(content, { constrained, menuIndex });
      } catch (retryErr) {
        throw retryErr;
      }
    }
    throw err;
  }
}

function logLlmFailure(err, apiMsg) {
  if (process.env.NODE_ENV === 'test') return;
  const status = err.response?.status;
  const msg = apiMsg || err.response?.data?.error?.message || err.message;
  const provider = getLlmProvider();
  if (status === 429) {
    if (provider === 'google') {
      console.warn('[llm] Gemini quota exhausted — add billing at https://ai.google.dev/ or switch LLM_PROVIDER=openrouter');
    } else {
      console.warn(`[llm] ${provider} rate limited (429): ${msg}`);
    }
  } else if (status === 503) {
    console.warn(`[llm] ${provider} overloaded (503) after retries: ${msg}`);
  } else {
    console.warn(`[llm] intent parse failed (${status ?? 'network'}): ${msg}`);
  }
}

async function parseOrderIntentWithLlm(userText, { phone, menu, model, provider, llmLabel } = {}) {
  const { primary, fallback } = await resolveLiveLlmTargets({ model, provider, llmLabel });
  if (!primary || !canCallLlm(phone, { provider: primary.provider })) return null;

  const menuIndex = (menu?.length) ? buildMenuLlmIndex(menu) : null;
  const started = Date.now();
  const targets = [primary];
  if (!model && !provider && fallback) targets.push(fallback);

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (!isProviderReady(target.provider)) continue;
    const displayLabel = target.llmLabel || (
      usesOpenAiCompatibleProvider(target.provider) && target.model
        ? `OR ${target.model}`
        : target.model
    );
    try {
      const outcome = usesOpenAiCompatibleProvider(target.provider)
        ? await callOpenAi(userText, {
          menuIndex,
          model: target.model,
          provider: target.provider,
        })
        : await callGemini(userText, { menuIndex, model: target.model });

      const result = outcome?.result ?? null;
      if (result) {
        await recordCallAndPersist(phone, {
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - started,
          ok: true,
        });
        if (process.env.LOG_LEVEL === 'debug') {
          const mode = result.menuConstrained ? 'menu' : 'free';
          console.log(`[llm] intent parsed (${mode}) provider=${target.provider} model=${target.model} in ${Date.now() - started}ms confidence=${result.confidence}`);
        }
        result.llmModel = displayLabel;
        result.llmProvider = target.provider;
        return result;
      }
      // Provider answered — count as success for admin config/history even if
      // the body was not usable as order intent (Teach-bot / pipeline decide that).
      await recordCallAndPersist(phone, {
        provider: target.provider,
        model: target.model,
        latencyMs: Date.now() - started,
        ok: true,
      });
      return null;
    } catch (err) {
      logLlmFailure(err, err.response?.data?.error?.message);
      const canFallback = i === 0 && targets.length > 1 && isRetryableLlmError(err);
      if (!canFallback) {
        await recordCallAndPersist(phone, {
          provider: target.provider,
          model: target.model,
          latencyMs: Date.now() - started,
          ok: false,
          error: err.response?.data?.error?.message || err.message || String(err.response?.status || 'error'),
        });
        return null;
      }
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[llm] primary intent failed; trying fallback ${targets[1].provider}/${targets[1].model}`);
      }
    }
  }
  return null;
}

/** Test helpers */
function _resetLlmState() {
  rateLimitByPhone.clear();
  dailyCallCount = 0;
  dailyCallDate = '';
  try {
    require('./llmRuntimeConfig').invalidateLlmRuntimeCache();
  } catch {
    // ignore if runtime module not loaded
  }
}

module.exports = {
  isAiIntentEnabled,
  canCallLlm,
  parseOrderIntentWithLlm,
  parseProposalEditWithLlm,
  parseBotCommandWithLlm,
  validateIntentPayload,
  validateMenuIntentPayload,
  validateEditPayload,
  validateCommandPayload,
  listPlaygroundModels,
  listPlaygroundEntries,
  parsePlaygroundModelEntry,
  resolvePlaygroundModel,
  getPlaygroundLlmConfig,
  getLlmModel,
  getLlmProvider,
  isProviderReady,
  getDailyCallStats,
  isRetryableLlmError,
  _resetLlmState,
};
