const axios = require('axios');

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
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '1500', 10);

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
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '1500', 10);
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
    const res = await axios.post(url, withSchema, {
      params: { key },
      headers: { 'Content-Type': 'application/json' },
      timeout,
    });
    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = validateEditPayload(parseJsonContent(content));
    if (parsed) return parsed;
  } catch (err) {
    const status = err.response?.status;
    if (status === 400) {
      try {
        const res = await axios.post(url, {
          ...baseBody,
          generationConfig: {
            ...baseBody.generationConfig,
            responseMimeType: 'application/json',
          },
        }, {
          params: { key },
          headers: { 'Content-Type': 'application/json' },
          timeout,
        });
        const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = validateEditPayload(parseJsonContent(content));
        if (parsed) return parsed;
      } catch (retryErr) {
        logLlmFailure(retryErr);
        throw retryErr;
      }
    }
    logLlmFailure(err, err.response?.data?.error?.message);
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

async function callOpenAi(userText) {
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '1500', 10);

  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'order_intent',
          strict: true,
          schema: OPENAI_INTENT_SCHEMA,
        },
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
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
  return validateIntentPayload(parseJsonContent(content));
}

async function callGemini(userText) {
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
  const timeout = parseInt(process.env.LLM_TIMEOUT_MS || '1500', 10);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const key = process.env.GEMINI_API_KEY;

  const baseBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { temperature: 0 },
  };

  const withSchema = {
    ...baseBody,
    generationConfig: {
      ...baseBody.generationConfig,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_INTENT_SCHEMA,
    },
  };

  try {
    const res = await axios.post(url, withSchema, {
      params: { key },
      headers: { 'Content-Type': 'application/json' },
      timeout,
    });
    const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = validateIntentPayload(parseJsonContent(content));
    if (parsed) return parsed;
  } catch (err) {
    const status = err.response?.status;
    const apiMsg = err.response?.data?.error?.message;
    if (status === 400) {
      // Schema rejected — retry JSON mode without strict schema.
      try {
        const res = await axios.post(url, {
          ...baseBody,
          generationConfig: {
            ...baseBody.generationConfig,
            responseMimeType: 'application/json',
          },
        }, {
          params: { key },
          headers: { 'Content-Type': 'application/json' },
          timeout,
        });
        const content = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = validateIntentPayload(parseJsonContent(content));
        if (parsed) return parsed;
      } catch (retryErr) {
        logLlmFailure(retryErr);
        throw retryErr;
      }
    }
    logLlmFailure(err, apiMsg);
    throw err;
  }

  return null;
}

function logLlmFailure(err, apiMsg) {
  if (process.env.NODE_ENV === 'test') return;
  const status = err.response?.status;
  const msg = apiMsg || err.response?.data?.error?.message || err.message;
  if (status === 429) {
    console.warn('[llm] Gemini quota exhausted — add billing at https://ai.google.dev/ or switch LLM_PROVIDER=openai');
  } else {
    console.warn(`[llm] intent parse failed (${status ?? 'network'}): ${msg}`);
  }
}

async function parseOrderIntentWithLlm(userText, { phone } = {}) {
  if (!canCallLlm(phone)) return null;

  const provider = (process.env.LLM_PROVIDER || 'google').toLowerCase();
  const started = Date.now();

  try {
    const result = provider === 'openai'
      ? await callOpenAi(userText)
      : await callGemini(userText);

    if (result) {
      recordCall(phone);
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(`[llm] intent parsed in ${Date.now() - started}ms confidence=${result.confidence}`);
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
  validateEditPayload,
  _resetLlmState,
};
