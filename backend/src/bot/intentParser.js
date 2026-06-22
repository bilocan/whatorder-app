const { parseOrderText, parseSpaceSeparatedQtyItems } = require('./orderParser');
const { canCallLlm, parseOrderIntentWithLlm } = require('../lib/llm');

const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'hallo', 'merhaba', 'selam', 'guten tag', 'guten morgen',
  'moin', 'servus', 'gruss gott', 'grüß gott', 'nasilsin', 'naber', 'start', 'menu',
  'menü', 'menüyü', 'bestellen', 'order', 'siparis', 'sipariş',
]);

const PARTY_SIZE_RE = [
  /\bfor\s+(\d+)\s*(?:people|persons|person|p)?\b/i,
  /\bfür\s+(\d+)\s*(?:personen|leute|p)?\b/i,
  /\b(\d+)\s*(?:people|persons|person|personen|leute|p)\b/i,
  /\b(\d+)\s*(?:kişi|kisi)\b/i,
  /\b(bir|iki|üç|uc|dört|dort|beş|bes)\s*(?:kişi|kisi|person|personen)\b/i,
];

const TURKISH_NUMBERS = { bir: 1, iki: 2, 'üç': 3, uc: 3, 'dört': 4, dort: 4, 'beş': 5, bes: 5 };

const GERMAN_NUMBERS = {
  ein: 1, eine: 1, eins: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, funf: 5, fünf: 5, sechs: 6,
};

function stripOrderTypePrefix(text) {
  return (text ?? '')
    .replace(/^\s*(zum mitnehmen|zum essen|takeaway|to go|abholen)\s*,?\s*/i, '')
    .trim();
}

function parseGermanLeadingQty(text) {
  const re = /^(ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs)\s+(.+)$/i;
  const m = (text ?? '').trim().match(re);
  if (!m) return null;
  const qty = GERMAN_NUMBERS[m[1].toLowerCase()];
  if (!qty) return null;
  return [{ qty, rawName: m[2].trim() }];
}

const GERMAN_CONJUNCTION_SPLIT = /\s+und\s+|\s+and\s+|\s*\+\s*|\s*,\s*|\bve\b/i;

const { isDrinkStem } = require('./smartDefaults');

const ORDER_NOISE_RE = /^(an einem|am einem|damit|bitte|please)$/i;

function isNoiseFragment(part) {
  const cleaned = stripPoliteSuffix((part ?? '').trim());
  return !cleaned || ORDER_NOISE_RE.test(cleaned);
}

/** "Zwei Hühner Kebab einen Döner" → 2x kebab + 1x döner */
function splitEmbeddedFoodInChunk(chunk) {
  const m = (chunk ?? '').trim().match(
    /^((?:ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs|\d+)\s+.+?)\s+(einen|eine|ein|eins|einer)\s+(.+)$/i,
  );
  if (!m) return null;

  const tail = stripPoliteSuffix(m[3].trim());
  if (!tail || isDrinkStem(tail) || isNoiseFragment(tail)) return null;

  const foodPart = m[1].trim();
  const foodItems = parseGermanLeadingQty(foodPart);
  if (!foodItems?.length) return null;

  const tailItems = parseGermanLeadingQty(`${m[2]} ${tail}`) ?? [{ qty: 1, rawName: tail }];
  return [...foodItems, ...tailItems.map(i => ({ ...i, rawName: stripPoliteSuffix(i.rawName) }))];
}

/** "Zwei Hühner Kebab ein Cola" → food qty 2 + drink qty 1 */
function splitEmbeddedDrinkInChunk(chunk) {
  const m = (chunk ?? '').trim().match(
    /^((?:ein|eine|eins|zwei|drei|vier|funf|fünf|sechs|\d+)\s+.+?)\s+(ein|eine|eins)\s+([\wäöüÄÖÜß-]+)$/i,
  );
  if (!m) return null;
  const drinkName = m[3].trim();
  if (!isDrinkStem(drinkName)) return null;

  const foodPart = m[1].trim();
  const foodItems = parseGermanLeadingQty(foodPart);
  if (!foodItems?.length) return null;

  return [...foodItems, { qty: 1, rawName: stripPoliteSuffix(drinkName) }];
}

function stripPoliteSuffix(name) {
  return (name ?? '').replace(/\s+bitte\s*$/i, '').trim();
}

/** "Eine Pizza Margherita und eine Spinaci" → two items (split before leading-qty parse). */
function parseGermanQtyItems(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(GERMAN_CONJUNCTION_SPLIT).map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return parseGermanLeadingQty(trimmed);

  const items = [];
  for (const part of parts) {
    if (isNoiseFragment(part)) continue;
    const embeddedFood = splitEmbeddedFoodInChunk(part);
    if (embeddedFood) {
      items.push(...embeddedFood);
      continue;
    }
    const embedded = splitEmbeddedDrinkInChunk(part);
    if (embedded) {
      items.push(...embedded);
      continue;
    }
    const leading = parseGermanLeadingQty(part);
    if (leading) {
      items.push(...leading);
      continue;
    }
    const digit = part.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (digit) {
      items.push({ qty: parseInt(digit[1], 10), rawName: digit[2].trim() });
      continue;
    }
    if (part.length >= 2) items.push({ qty: 1, rawName: stripPoliteSuffix(part) });
  }
  return items.length >= 2 ? items.map(i => ({ ...i, rawName: stripPoliteSuffix(i.rawName) })) : null;
}

/** "zwei döner mit allem einer ohne zwiebel" → 1x mit allem + 1x ohne (total = leading qty). */
function splitOneWithoutModifier(text) {
  const m = (text ?? '').trim().match(
    /^(zwei|drei|vier|funf|fünf|sechs|\d+)\s+(.+?)\s+mit\s+allem\s+(einer|eine|ein)\s+(ohne\s+[\wäöüÄÖÜß-]+)\s*$/i,
  );
  if (!m) return null;

  const totalQty = GERMAN_NUMBERS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
  if (!totalQty || totalQty < 2) return null;

  const dishBase = m[2].trim();
  if (/\b(einer|eine|ein|eins)\b/i.test(dishBase)) return null;
  const ohneSuffix = m[4].trim();
  const withAllName = `${dishBase} mit allem`;
  const ohneName = `${dishBase} ${ohneSuffix}`;

  return [
    { qty: totalQty - 1, rawName: withAllName },
    { qty: 1, rawName: ohneName },
  ];
}

const ORDER_SIGNAL_RE = /(\d+\s*x\b|\bx\s*\d+|\d+\s+\w|\+\s*\w|,\s*\w|\bund\b|\band\b|\bve\b|\bmit\b|\bwith\b)/i;

const ORDER_FILLER_RE = /\b(bitte|jeweils|gerne|danke|please|dazu|extra)\b/i;

function rulesItemsLookSuspicious(items) {
  return (items ?? []).some(i => {
    const n = (i.rawName ?? i.name ?? '').trim();
    if (!n) return true;
    if (ORDER_FILLER_RE.test(n)) return true;
    if (n.split(/\s+/).filter(Boolean).length > 4) return true;
    return false;
  });
}

/** Trailing "und jeweils einer Ayran" → one drink per food item already parsed. */
function extractJeweilsDrinkSuffix(text) {
  const m = (text ?? '').trim().match(
    /\s+und\s+jeweils\s+(?:einer|eine|ein)\s+(?:bitte\s+)?([a-zA-ZäöüÄÖÜß-]+)(?:\s+bitte)?\s*$/i,
  );
  if (!m) return null;
  return {
    drink: m[1].trim(),
    main: text.slice(0, m.index).trim(),
  };
}

function extractPartySize(text) {
  for (const re of PARTY_SIZE_RE) {
    const m = text.match(re);
    if (!m) continue;
    const raw = m[1].toLowerCase();
    if (TURKISH_NUMBERS[raw] != null) return TURKISH_NUMBERS[raw];
    const n = parseInt(raw, 10);
    if (n > 0 && n <= 99) return n;
  }
  return null;
}

function stripPartySizePhrases(text) {
  let out = text;
  for (const re of PARTY_SIZE_RE) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function parseTurkishQtyItems(text) {
  const re = /\b(bir|iki|üç|uc|dört|dort|beş|bes)\s+([a-zA-ZäöüÄÖÜßıİ-]+)/gi;
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({ qty: TURKISH_NUMBERS[m[1].toLowerCase()], rawName: m[2].trim() });
  }
  return items;
}

function isGreetingOnly(norm) {
  const cleaned = norm.replace(/[!?.]+/g, '').trim();
  return GREETINGS.has(cleaned);
}

function looksLikeOrderText(text, norm) {
  if (!text || text.length < 2) return false;
  if (isGreetingOnly(norm)) return false;
  if (parseOrderText(text).length) return true;
  if (parseTurkishQtyItems(text).length) return true;
  if (ORDER_SIGNAL_RE.test(text)) return true;
  // Single word ≥3 chars — try menu match later
  if (/^[a-zA-ZäöüÄÖÜßıİ0-9\s-]{3,}$/.test(text.trim()) && !isGreetingOnly(norm)) return true;
  return false;
}

function toIntentResult(items, partySize, rawText, parsedBy, confidence) {
  const result = {
    items: items.map(i => ({ name: i.rawName ?? i.name, qty: i.qty ?? 1 })),
    partySize,
    rawText,
    parsedBy,
  };
  if (confidence != null) result.confidence = confidence;
  return result;
}

function parseIntent(text) {
  const rawText = (text ?? '').trim();
  const partySize = extractPartySize(rawText);
  let stripped = stripPartySizePhrases(rawText);
  stripped = stripOrderTypePrefix(stripped);

  const jeweils = extractJeweilsDrinkSuffix(stripped);
  if (jeweils) stripped = jeweils.main;

  let items = splitOneWithoutModifier(stripped);
  if (!items?.length) items = parseGermanQtyItems(stripped);
  if (!items?.length) items = parseTurkishQtyItems(stripped);
  if (!items?.length) items = parseSpaceSeparatedQtyItems(stripped) ?? parseOrderText(stripped);

  if (jeweils?.drink && items?.length) {
    items = [...items, { qty: items.length, rawName: jeweils.drink }];
  }

  const usedSingleBlobFallback = !items.length
    && stripped.length >= 2
    && !isGreetingOnly(stripped.toLowerCase());

  if (usedSingleBlobFallback) {
    items = [{ qty: 1, rawName: stripped }];
  }

  if (partySize && items.length) {
    items = items.map(item => ({
      ...item,
      qty: item.qty ?? 1,
    }));
  }

  return toIntentResult(items, partySize, rawText, 'rules');
}

/** High = rules split multiple items cleanly; skip LLM. */
function rulesParseQuality(text) {
  const rawText = (text ?? '').trim();
  let stripped = stripPartySizePhrases(rawText);
  stripped = stripOrderTypePrefix(stripped);

  const jeweils = extractJeweilsDrinkSuffix(stripped);
  if (jeweils) stripped = jeweils.main;

  let items = splitOneWithoutModifier(stripped);
  if (!items?.length) items = parseGermanQtyItems(stripped);
  if (jeweils?.drink && items?.length) {
    items = [...items, { qty: items.length, rawName: jeweils.drink }];
  }
  if (rulesItemsLookSuspicious(items)) return 'low';

  if (splitOneWithoutModifier(stripped)?.length >= 2) return 'high';
  if (parseGermanQtyItems(stripped)?.length >= 2) return 'high';
  const germanLeading = parseGermanLeadingQty(stripped);
  if (germanLeading?.length === 1 && !/\b(ohne|einer|eine|und|mit)\b/i.test(germanLeading[0].rawName)) {
    return 'high';
  }
  if (parseTurkishQtyItems(stripped).length >= 2) return 'high';
  if (parseSpaceSeparatedQtyItems(stripped)?.length >= 2) return 'high';

  const parsed = parseOrderText(stripped);
  if (parsed.length >= 2) return 'high';
  if (parsed.length === 1 && /\d+\s*x?\s+/i.test(stripped)) return 'high';

  return 'low';
}

function shouldTryLlm(text, rulesIntent, phone) {
  if (!canCallLlm(phone)) return false;
  if (rulesItemsLookSuspicious(rulesIntent.items)) return true;
  if (rulesParseQuality(text) === 'high') return false;
  if (!rulesIntent.items.length) return true;

  const stripped = stripOrderTypePrefix(stripPartySizePhrases((text ?? '').trim()));
  const hasConjunction = /\b(and|und|ve|mit|with|plus)\b|[,+]/i.test(stripped);
  const hasPartySize = rulesIntent.partySize != null;
  const singleBlob = rulesIntent.items.length === 1
    && rulesIntent.items[0].name.length > stripped.length * 0.8;

  return hasConjunction || hasPartySize || singleBlob;
}

function mergeLlmIntent(llm, rawText, rulesIntent) {
  const partySize = llm.partySize ?? rulesIntent.partySize ?? null;
  let items = llm.items.map(i => ({
    rawName: i.name,
    qty: i.qty ?? (partySize ? 1 : 1),
  }));

  if (partySize && items.length && items.every(i => i.qty === 1)) {
    items = items.map(i => ({ ...i, qty: 1 }));
  }

  return toIntentResult(items, partySize, rawText, 'llm', llm.confidence);
}

async function parseIntentAsync(text, { phone } = {}) {
  const rulesIntent = parseIntent(text);

  if (!shouldTryLlm(text, rulesIntent, phone)) return rulesIntent;

  const llm = await parseOrderIntentWithLlm(text, { phone });
  if (!llm || llm.confidence < 0.6 || !llm.items.length) {
    return { ...rulesIntent, llmAttempted: true, llmFailed: true };
  }

  return mergeLlmIntent(llm, rulesIntent.rawText, rulesIntent);
}

module.exports = {
  parseIntent,
  parseIntentAsync,
  looksLikeOrderText,
  isGreetingOnly,
  extractPartySize,
  rulesParseQuality,
  shouldTryLlm,
};
