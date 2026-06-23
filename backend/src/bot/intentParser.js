const { parseOrderText, parseSpaceSeparatedQtyItems } = require('./orderParser');
const { canCallLlm, parseOrderIntentWithLlm } = require('../lib/llm');
const {
  stripIntentModifiers, wantsAllIncluded, parseExclusions, isModifierOnlyToken,
} = require('./intentModifiers');

const MIT_ALLEM_RE = 'mit\\s+(?:allem|allen)';

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

/** "ich hätte gerne zwei döner" → "zwei döner" */
function stripPolitePrefix(text) {
  return (text ?? '')
    .replace(
      /^\s*ich\s+(?:hätte|hatte|möchte|moechte|will|würde|wuerde)\s+(?:gerne\s+)?/i,
      '',
    )
    .replace(/^\s*hätte\s+gerne\s+/i, '')
    .trim();
}

/** "noch ein kebap" → "kebap" */
function stripContinuationPrefix(text) {
  return (text ?? '')
    .replace(/^\s*noch\s+(?:ein|eine|einen|einer)\s+/i, '')
    .replace(/^\s*(?:auch|nochmal)\s+(?:ein|eine|einen|einer)\s+/i, '')
    .trim();
}

function attachOrphanModifierFragment(items, fragment) {
  const token = stripPoliteSuffix((fragment ?? '').trim());
  if (!token || !isModifierOnlyToken(token) || !items.length) return false;
  const prev = items[items.length - 1];
  prev.rawName = `${prev.rawName} und ${token}`;
  return true;
}

function mergeOrphanModifierFragments(items) {
  if (!items?.length) return items ?? [];
  const out = [];
  for (const item of items) {
    const name = (item.rawName ?? item.name ?? '').trim();
    if (isModifierOnlyToken(stripPoliteSuffix(name)) && out.length) {
      const prev = out[out.length - 1];
      prev.rawName = `${prev.rawName} und ${stripPoliteSuffix(name)}`;
    } else {
      out.push({ ...item });
    }
  }
  return out;
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
const { extractDishNameForMatch } = require('./intentModifiers');

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

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
    if (attachOrphanModifierFragment(items, part)) continue;
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

/**
 * Split "N of same dish, one with all / one without …" phrasing into two lines.
 * Covers: mit allem einer ohne … | einer mit allem einer ohne … | eine mit allem und andere ohne …
 */
function splitOneWithoutModifier(text) {
  const trimmed = stripPoliteSuffix((text ?? '').trim());
  const qty = '(zwei|drei|vier|funf|fünf|sechs|\\d+)';
  const ohne = '(ohne\\s+.+?)';
  const variants = [
    new RegExp(`^${qty}\\s+(.+?)\\s+${MIT_ALLEM_RE}\\s+(?:einer|eine|ein)\\s+${ohne}\\s*$`, 'i'),
    new RegExp(
      `^${qty}\\s+(.+?)\\s+(?:einer|eine|ein)\\s+${MIT_ALLEM_RE}\\s+(?:einer|eine|ein)\\s+${ohne}\\s*$`,
      'i',
    ),
    new RegExp(
      `^${qty}\\s+(.+?)\\s+(?:einer|eine|ein)\\s+${MIT_ALLEM_RE}\\s+und\\s+(?:die\\s+)?(?:andere|anderer|anderes)\\s+${ohne}\\s*$`,
      'i',
    ),
  ];

  for (const re of variants) {
    const m = trimmed.match(re);
    if (!m) continue;

    const totalQty = GERMAN_NUMBERS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    if (!totalQty || totalQty < 2) continue;

    const dishBase = m[2].trim();
    if (/\b(einer|eine|ein|eins)\b/i.test(dishBase)) continue;

    const ohneSuffix = m[3].trim();
    const withAllName = `${dishBase} mit allem`;
    const ohneName = `${dishBase} ${ohneSuffix}`;

    return [
      { qty: totalQty - 1, rawName: withAllName },
      { qty: 1, rawName: ohneName },
    ];
  }
  return null;
}

const ORDER_SIGNAL_RE = /(\d+\s*x\b|\bx\s*\d+|\d+\s+\w|\+\s*\w|,\s*\w|\bund\b|\band\b|\bve\b|\bmit\b|\bwith\b)/i;

const ORDER_FILLER_RE = /\b(bitte|jeweils|gerne|danke|please|dazu|extra)\b/i;

function rulesItemsLookSuspicious(items) {
  return (items ?? []).some(i => {
    const n = (i.rawName ?? i.name ?? '').trim();
    if (!n) return true;
    if (ORDER_FILLER_RE.test(n)) return true;
    if (/^(?:mit\s+(?:allem|allen|alles)|ohne\s+)/i.test(n)) return true;
    if (isModifierOnlyToken(n)) return true;
    const dishOnly = stripIntentModifiers(n);
    if (dishOnly.split(/\s+/).filter(Boolean).length > 4) return true;
    return false;
  });
}

/** Rules split same dish into per-unit modifier lines — do not let LLM collapse to 2x bare item. */
function rulesIntentHasModifierSplit(rulesIntent) {
  const items = rulesIntent?.items ?? [];
  if (items.length < 2) return false;
  return items.every(i => wantsAllIncluded(i.name) || parseExclusions(i.name).length > 0);
}

/** "und jeweils einer Ayran" on same utterance, or standalone "jeweils ayran noch bitte". */
function extractJeweilsDrink(text) {
  const trimmed = (text ?? '').trim();

  const suffixM = trimmed.match(
    /\s+und\s+jeweils\s+(?:einer|eine|ein|einen)\s+(?:bitte\s+)?([a-zA-ZäöüÄÖÜß-]+)(?:\s+bitte)?\s*$/i,
  );
  if (suffixM) {
    return {
      drink: stripPoliteSuffix(suffixM[1].trim()),
      main: trimmed.slice(0, suffixM.index).trim(),
    };
  }

  const standaloneM = trimmed.match(
    /^(?:noch\s+)?jeweils\s+(?:(?:ein|eine|einer|einen)\s+)?(?:bitte\s+)?([a-zA-ZäöüÄÖÜß-]+)(?:\s+(?:noch|bitte))*\s*$/i,
  );
  if (standaloneM) {
    return { drink: stripPoliteSuffix(standaloneM[1].trim()), main: '' };
  }

  return null;
}

function foodQtySum(items) {
  return (items ?? []).reduce((sum, i) => sum + (i.qty ?? 1), 0);
}

function lineLooksLikeDrink(name) {
  const dish = norm(extractDishNameForMatch(name) || name);
  const words = dish.split(/[\s—,-]+/).filter(Boolean);
  if (words.some(w => isDrinkStem(w))) return true;
  return isDrinkStem(dish);
}

function basketMealQty(basket) {
  return (basket ?? []).reduce((sum, line) => {
    if (lineLooksLikeDrink(line.name)) return sum;
    return sum + (line.qty ?? 1);
  }, 0);
}

function isJeweilsContinuationText(rawText) {
  return /^(?:noch\s+)?jeweils\b/i.test((rawText ?? '').trim());
}

/** Scale drink qty to basket meals for "jeweils ayran" after kebabs are already in cart. */
function applyJeweilsBasketContext(intent, basket) {
  if (!isJeweilsContinuationText(intent?.rawText)) return intent;
  const items = intent.items ?? [];
  if (items.length !== 1) return intent;

  const mealQty = basketMealQty(basket);
  if (mealQty < 1) return intent;

  return {
    ...intent,
    items: [{ ...items[0], qty: mealQty }],
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
  if (/^(?:noch\s+)?jeweils\b/i.test(text.trim())) return true;
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
  stripped = stripPolitePrefix(stripped);
  stripped = stripContinuationPrefix(stripped);

  const jeweils = extractJeweilsDrink(stripped);
  if (jeweils) stripped = jeweils.main;

  let items = splitOneWithoutModifier(stripped);
  if (!items?.length && jeweils?.drink && !jeweils.main) {
    items = [{ qty: 1, rawName: jeweils.drink }];
  }
  if (!items?.length) items = parseGermanQtyItems(stripped);
  if (!items?.length) items = parseTurkishQtyItems(stripped);
  if (!items?.length) items = parseSpaceSeparatedQtyItems(stripped) ?? parseOrderText(stripped);

  if (jeweils?.drink && items?.length && jeweils.main) {
    const perMeal = foodQtySum(items.filter(i => !isDrinkStem(stripPoliteSuffix(i.rawName ?? ''))));
    items = [...items, { qty: perMeal || items.length, rawName: jeweils.drink }];
  }

  const usedSingleBlobFallback = !items.length
    && stripped.length >= 2
    && !isGreetingOnly(stripped.toLowerCase())
    && !jeweils?.drink;

  if (usedSingleBlobFallback) {
    items = [{ qty: 1, rawName: stripped }];
  }

  if (partySize && items.length) {
    items = items.map(item => ({
      ...item,
      qty: item.qty ?? 1,
    }));
  }

  items = mergeOrphanModifierFragments(items);

  return toIntentResult(items, partySize, rawText, 'rules');
}

/** High = rules split multiple items cleanly; skip LLM. */
function rulesParseQuality(text) {
  const rawText = (text ?? '').trim();
  let stripped = stripPartySizePhrases(rawText);
  stripped = stripOrderTypePrefix(stripped);
  stripped = stripPolitePrefix(stripped);
  stripped = stripContinuationPrefix(stripped);

  const jeweils = extractJeweilsDrink(stripped);
  if (jeweils) stripped = jeweils.main;

  let items = splitOneWithoutModifier(stripped);
  if (!items?.length) items = parseGermanQtyItems(stripped);
  if (jeweils?.drink && items?.length && jeweils.main) {
    const perMeal = foodQtySum(items.filter(i => !isDrinkStem(stripPoliteSuffix(i.rawName ?? ''))));
    items = [...items, { qty: perMeal || items.length, rawName: jeweils.drink }];
  }

  if (splitOneWithoutModifier(stripped)?.length >= 2) return 'high';
  const germanQtyItems = parseGermanQtyItems(stripped);
  if (germanQtyItems?.length >= 2) {
    return rulesItemsLookSuspicious(germanQtyItems) ? 'low' : 'high';
  }
  if (rulesItemsLookSuspicious(items)) return 'low';

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
  if (rulesIntentHasModifierSplit(rulesIntent)) return false;
  if (rulesParseQuality(text) === 'high') return false;
  if (rulesItemsLookSuspicious(rulesIntent.items)) return true;
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

  if (rulesIntentHasModifierSplit(rulesIntent) && llm.items.length < rulesIntent.items.length) {
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
  applyJeweilsBasketContext,
  basketMealQty,
};
