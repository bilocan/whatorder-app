const axios = require('axios');
const { buildMenuLlmIndex, resolveMenuLlmItems } = require('../bot/menuLlmIndex');
const { repairMenuLlmRawItems } = require('../bot/menuLlmRepair');

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

const rateLimitByPhone = new Map();
let dailyCallCount = 0;
let dailyCallDate = '';

function isAiIntentEnabled() {
  if (process.env.AI_INTENT_ENABLED !== 'true') return false;
  const provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();
  if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.GEMINI_API_KEY);
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

function recordCall(phone) {
  resetDailyCapIfNeeded();
  dailyCallCount += 1;
  if (phone) rateLimitByPhone.set(phone, Date.now());
}

function canCallLlm(phone) {
  return isAiIntentEnabled() && isWithinDailyCap() && isWithinRateLimit(phone);
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
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateIntentPayload(data) {
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.items)) return null;
  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) return null;

  const items = data.items
    .filter(i => i && typeof i.name === 'string' && i.name.trim())
    .map(i => ({
      name: i.name.trim(),
      qty: i.qty == null ? null : Math.min(99, Math.max(1, Number(i.qty) || 1)),
    }));

  let partySize = null;
  if (data.partySize != null) {
    const n = parseInt(data.partySize, 10);
    if (n > 0 && n <= 99) partySize = n;
  }

  return { items, partySize, confidence: Math.max(0, Math.min(1, confidence)) };
}

function validateMenuIntentPayload(data, menuIndex) {
  if (!data || typeof data !== 'object' || !menuIndex?.byId) return null;
  const confidence = Number(data.confidence);
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

async function callOpenAiEdit(userText) {
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
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
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout,
    },
  );

  const content = res.data?.choices?.[0]?.message?.content;
  return validateEditPayload(parseJsonContent(content));
}

async function callGeminiEdit(userText) {
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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

async function parseProposalEditWithLlm(text, pendingItems, { phone } = {}) {
  if (!canCallLlm(phone)) return null;

  const orderLines = (pendingItems ?? [])
    .map(p => `${p.qty}x ${p.name}`)
    .join('\n');
  const userText = `Current proposed order:\n${orderLines}\n\nCustomer edit:\n${text}`;

  const provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();
  const started = Date.now();

  try {
    const result = provider === 'openai'
      ? await callOpenAiEdit(userText)
      : await callGeminiEdit(userText);

    if (result) {
      recordCall(phone);
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`[llm] proposal edit parsed in ${Date.now() - started}ms type=${result.type} confidence=${result.confidence}`);
      }
    }
    return result;
  } catch (err) {
    logLlmFailure(err, err.response?.data?.error?.message);
    return null;
  }
}

async function callOpenAi(userText, { menuIndex = null } = {}) {
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const constrained = !!menuIndex?.byId?.size;
  const systemPrompt = constrained ? MENU_CONSTRAINED_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const schema = constrained ? OPENAI_MENU_INTENT_SCHEMA : OPENAI_INTENT_SCHEMA;
  const promptText = constrained ? buildMenuConstrainedUserText(userText, menuIndex) : userText;

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
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
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout,
    },
  );

  const content = res.data?.choices?.[0]?.message?.content;
  const parsed = parseJsonContent(content);
  return constrained
    ? validateMenuIntentPayload(parsed, menuIndex)
    : validateIntentPayload(parsed);
}

async function callGemini(userText, { menuIndex = null } = {}) {
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '8000', 10);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
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
    const parsed = parseJsonContent(content);
    return constrained
      ? validateMenuIntentPayload(parsed, menuIndex)
      : validateIntentPayload(parsed);
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
        const parsed = parseJsonContent(content);
        return constrained
          ? validateMenuIntentPayload(parsed, menuIndex)
          : validateIntentPayload(parsed);
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
  if (status === 429) {
    console.warn('[llm] Gemini quota exhausted — add billing at https://ai.google.dev/ or switch LLM_PROVIDER=openai');
  } else if (status === 503) {
    console.warn(`[llm] Gemini overloaded (503) after retries: ${msg}`);
  } else {
    console.warn(`[llm] intent parse failed (${status ?? 'network'}): ${msg}`);
  }
}

async function parseOrderIntentWithLlm(userText, { phone, menu } = {}) {
  if (!canCallLlm(phone)) return null;

  const menuIndex = (menu?.length) ? buildMenuLlmIndex(menu) : null;
  const provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();
  const started = Date.now();

  try {
    const result = provider === 'openai'
      ? await callOpenAi(userText, { menuIndex })
      : await callGemini(userText, { menuIndex });

    if (result) {
      recordCall(phone);
      if (process.env.LOG_LEVEL === 'debug') {
        const mode = result.menuConstrained ? 'menu' : 'free';
        console.log(`[llm] intent parsed (${mode}) in ${Date.now() - started}ms confidence=${result.confidence}`);
      }
    }
    return result;
  } catch (err) {
    logLlmFailure(err, err.response?.data?.error?.message);
    return null;
  }
}

/** Test helpers */
function _resetLlmState() {
  rateLimitByPhone.clear();
  dailyCallCount = 0;
  dailyCallDate = '';
}

module.exports = {
  isAiIntentEnabled,
  canCallLlm,
  parseOrderIntentWithLlm,
  parseProposalEditWithLlm,
  validateIntentPayload,
  validateMenuIntentPayload,
  validateEditPayload,
  _resetLlmState,
};
