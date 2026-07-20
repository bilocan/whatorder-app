const { parseOrderText, parseSpaceSeparatedQtyItems } = require('./orderParser');
const { canCallLlm, parseOrderIntentWithLlm } = require('../lib/llm');
const { buildMenuLlmIndex } = require('./menuLlmIndex');
const { repairIntentItems } = require('./menuLlmRepair');
const { lookupLearnedIntent, normalizeOperation, persistReboundLearnedItems } = require('./intentLearning');
const { learnedItemIdsChanged } = require('./intentLearningRebind');
const { intentLearnKey, stripImperativePrefix } = require('./intentNormalize');
const { detectRemovePhrase, REMOVE_SUFFIX_RE } = require('./intentRemoveDetect');
const { shouldRejectStaleLearnedHit } = require('./intentPartialMatch');
const { isBotCommandPhrase } = require('./botCommands');
const {
  stripIntentModifiers, wantsAllIncluded, parseExclusions, isModifierOnlyToken,
} = require('./intentModifiers');

const MIT_ALLEM_RE = 'mit\\s+(?:allem|allen|alles)';
const GERMAN_QTY_WORD_BY_NUM = { 2: 'zwei', 3: 'drei', 4: 'vier', 5: 'funf', 6: 'sechs' };

const GREETINGS = new Set([
  'hi', 'hello', 'hey', 'hallo', 'merhaba', 'selam', 'guten tag', 'guten morgen',
  'moin', 'servus', 'gruss gott', 'grüß gott', 'nasilsin', 'naber', 'menu',
  'menü', 'menüyü', 'bestellen', 'order', 'siparis', 'sipariş',
]);

/** Restart ordering — same UX as English "start", not a menu item or greeting. */
const FRESH_START_COMMANDS = new Set(['start', 'starten']);

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

/** "ich hätte gerne zwei döner" / "ich esse doner mit salad" → order core */
function stripPolitePrefix(text) {
  return (text ?? '')
    .replace(/^\s*hallo\s+/i, '')
    .replace(/^\s*bitte\s+/i, '')
    .replace(
      /^\s*(?:ich|wir)\s+(?:hätte|hatte|hätten|hatten|möchte|moechte|möchten|moechten|will|wollen|würde|wuerde|würden|wuerden|esse|essen|nehme|nehmen|kriege|krieg|kriegen|bekomme|bekommen)\s+(?:gerne\s+)?/i,
      '',
    )
    .replace(/^\s*hätte\s+gerne\s+/i, '')
    .trim();
}

/** "noch ein kebap" / "noch 3 cola" / "noch dazu zwei cola" → strip leading continuation */
function stripContinuationPrefix(text) {
  return (text ?? '')
    .replace(/^\s*noch\s+(\d+)\s+/i, '$1 ')
    .replace(/^\s*noch\s+(?:ein|eine|einen|einer|dazu)\s+/i, '')
    .replace(/^\s*(?:auch|nochmal)\s+(?:ein|eine|einen|einer)\s+/i, '')
    .trim();
}

/** TR "1 kola daha" / "kola daha" → strip trailing daha before product lookup */
function stripTurkishDahaSuffix(text) {
  const trimmed = (text ?? '').trim();
  const m = trimmed.match(/^(.+?)\s+daha\s*$/i);
  return m ? m[1].trim() : trimmed;
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
  return [{ qty, rawName: stripPoliteSuffix(m[2].trim()) }];
}

const GERMAN_CONJUNCTION_SPLIT = /\s+und\s+|\s+and\s+|\s*\+\s*|\s*,\s*|\bve\b/i;
const GERMAN_CONJUNCTION_SEP_RE = /\s+und\s+|\s+and\s+|\s*\+\s*|\s*,\s*|\bve\b/gi;
const GERMAN_QTY_WORD_RE = /^(?:ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs|\d+)\b/i;

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

/** Sandbox copy-paste / logging artifacts: leading >, wrapping or trailing quotes. */
function sanitizeIntentText(text) {
  let s = (text ?? '').trim();
  s = s.replace(/^\s*>\s*/, '');
  s = s.replace(/^["'„«»`]+/, '').replace(/["'«»„`]+$/g, '').trim();
  // TTS / fast typing: "2doner" → "2 doner" so qty+item parsers split correctly.
  s = s.replace(/(\d)([a-zA-ZäöüÄÖÜß])/g, '$1 $2');
  return s;
}

function stripPoliteSuffix(name) {
  return (name ?? '')
    .replace(/\s+bitte\b[\s"'«»„!.?]*$/i, '')
    .replace(/[\s"'«»„!.?]+$/g, '')
    .trim();
}

/** Keep "pide mit Eier und gouda" on one line; still split "Pizza und eine Cola". */
function shouldSkipMitIngredientUndSplit(before, after) {
  const left = (before ?? '').trim();
  const right = (after ?? '').trim();
  if (!left || !right) return false;
  if (!/\bmit\s+/i.test(left)) return false;
  if (GERMAN_QTY_WORD_RE.test(right)) return false;

  const einArticle = right.match(/^(?:ein|eine|eins|einen|einer)\s+(\S+)/i);
  if (einArticle && isDrinkStem(einArticle[1])) return false;
  if (isDrinkStem(right.split(/\s+/)[0])) return false;

  return right.split(/\s+/).filter(Boolean).length <= 2;
}

function splitGermanConjunctionParts(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];

  const parts = [];
  let lastIndex = 0;
  let m;
  const re = new RegExp(GERMAN_CONJUNCTION_SEP_RE.source, 'gi');
  while ((m = re.exec(trimmed)) !== null) {
    const isUndLike = /und|and/i.test(m[0]) || m[0].toLowerCase() === 've';
    if (isUndLike && shouldSkipMitIngredientUndSplit(
      trimmed.slice(lastIndex, m.index),
      trimmed.slice(m.index + m[0].length),
    )) {
      continue;
    }
    const chunk = trimmed.slice(lastIndex, m.index).trim();
    if (chunk) parts.push(chunk);
    lastIndex = m.index + m[0].length;
  }
  const tail = trimmed.slice(lastIndex).trim();
  if (tail) parts.push(tail);
  return parts;
}

/** "Eine Pizza Margherita und eine Spinaci" → two items (split before leading-qty parse). */
function parseGermanQtyItems(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const parts = splitGermanConjunctionParts(trimmed);
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

function extractBeideMitAllemSpicyDish(text) {
  let stripped = stripPolitePrefix(stripOrderTypePrefix(stripPoliteSuffix((text ?? '').trim())));
  const withoutQty = stripped.replace(
    /^(?:ein|eine|eins|einen|einer|zwei|drei|vier|funf|fünf|sechs|\d+)\s+/i,
    '',
  );
  return parseBeideMitAllemSpicyCore(withoutQty) ?? parseBeideMitAllemSpicyCore(stripped);
}

function textLooksLikeBeideMitAllemOneSpicy(text) {
  return !!extractBeideMitAllemSpicyDish(text);
}

function beideMitAllemSpicyLines(dishBase, totalQty) {
  return [
    { qty: totalQty - 1, rawName: `${dishBase} mit allen ohne scharf` },
    { qty: 1, rawName: `${dishBase} mit allen und scharf` },
  ];
}

/** "doner beide mit allen eine extra scharf" → dish base or null. */
function parseBeideMitAllemSpicyCore(text) {
  const trimmed = stripPoliteSuffix((text ?? '').trim());
  const m = trimmed.match(
    /^(.+?)\s+beide\s+mit\s+(?:allem|allen|alles)\s+(?:(?:eine|einer|eins|ein)\s+)?(?:extra\s+)?(?:und\s+)?scharf(?:e)?\s*$/i,
  );
  if (!m) return null;
  const dishBase = m[1].trim();
  if (/\b(einer|eine|eins|ein|beide)\b/i.test(dishBase)) return null;
  return dishBase;
}

/**
 * "zwei döner beide mit allen eine extra scharf" → one mit allen + one mit allen und scharf.
 */
function splitBeideMitAllemOneSpicy(text) {
  const trimmed = stripPoliteSuffix((text ?? '').trim());
  const qty = '(zwei|drei|vier|funf|fünf|sechs|\\d+)';
  const m = trimmed.match(new RegExp(`^${qty}\\s+(.+)$`, 'i'));
  if (!m) return null;

  const totalQty = GERMAN_NUMBERS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
  if (!totalQty || totalQty < 2) return null;

  const dishBase = parseBeideMitAllemSpicyCore(m[2]);
  if (!dishBase) return null;
  return beideMitAllemSpicyLines(dishBase, totalQty);
}

/** Recover split when leading-qty parse collapsed "2x doner beide mit … eine scharf". */
function normalizeBeideMitAllemSpicyItems(items) {
  if (items?.length !== 1 || (items[0].qty ?? 1) < 2) return items;

  const item = items[0];
  const qty = item.qty ?? 1;
  const raw = stripPoliteSuffix(item.rawName ?? item.name ?? '');
  const dishBase = parseBeideMitAllemSpicyCore(raw);
  if (dishBase) return beideMitAllemSpicyLines(dishBase, qty);

  const qtyWord = GERMAN_QTY_WORD_BY_NUM[qty] ?? String(qty);
  return splitBeideMitAllemOneSpicy(`${qtyWord} ${raw}`) ?? items;
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

function isFreshStartCommand(norm) {
  const cleaned = (norm ?? '').replace(/[!?.]+/g, '').trim();
  return FRESH_START_COMMANDS.has(cleaned);
}

/**
 * "ein dürüm mit tomaten ohne sose zum trinken cola" →
 * { food: "ein dürüm mit tomaten ohne sose", drink: "cola" }
 *
 * Drink can be 1-3 words (e.g. "cola", "eis tee", "eis tee pfirsich").
 */
function extractZumTrinkenDrink(text) {
  const m = (text ?? '').match(
    /^(.+?)\s+zum\s+trinken\s+([\wäöüÄÖÜß]+(?:\s+[\wäöüÄÖÜß]+){0,2})\s*$/i,
  );
  if (!m) return null;
  const food = m[1].trim();
  const drink = m[2].trim();
  return food && drink ? { food, drink } : null;
}

/** "Lahmacun cola" → food + drink without conjunction or LLM. */
function parseFoodDrinkPair(text) {
  const trimmed = stripPoliteSuffix((text ?? '').trim());
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [food, drink] = parts;
  if (/^\d+\s*x?$/i.test(food) || GERMAN_QTY_WORD_RE.test(food)) return null;
  if (isDrinkStem(food) || !isDrinkStem(drink)) return null;
  if (isNoiseFragment(food) || isNoiseFragment(drink)) return null;
  return [{ qty: 1, rawName: food }, { qty: 1, rawName: drink }];
}

function looksLikeOrderText(text, norm) {
  if (!text || text.length < 2) return false;
  if (isBotCommandPhrase(text, norm)) return false;
  if (isGreetingOnly(norm) || isFreshStartCommand(norm)) return false;
  if (parseOrderText(text).length) return true;
  if (parseTurkishQtyItems(text).length) return true;
  if (/^(?:noch\s+)?jeweils\b/i.test(text.trim())) return true;
  if (ORDER_SIGNAL_RE.test(text)) return true;
  // Single word ≥3 chars — try menu match later
  if (/^[a-zA-ZäöüÄÖÜßıİ0-9\s-]{3,}$/.test(text.trim()) && !isGreetingOnly(norm)) return true;
  return false;
}

/** Stricter than looksLikeOrderText — for checkout name guard (M2). */
function isStrongOrderText(text, norm) {
  if (!text?.trim() || text.length < 2) return false;
  if (isGreetingOnly(norm) || isFreshStartCommand(norm)) return false;
  if (/^(?:noch\s+)?jeweils\b/i.test(text.trim())) return true;
  if (/\b(?:dazu|noch ein|noch eine|noch einen|eine extra|einen extra)\b/i.test(norm)) return true;
  if (/\d+\s*(?:x|×|\*)\s*\w/i.test(text)) return true;
  if (/^\d+\s+[a-zäöüß]{3,}/i.test(text.trim())) return true;
  if (parseTurkishQtyItems(text).length) return true;
  if (detectRemovePhrase(text) && /\b(?:raus|ohne|entfernen|çıkar|löschen|weg|remove|delete)\b/i.test(norm)) {
    return true;
  }
  const items = parseOrderText(text);
  if (items.length > 1) return true;
  if (items.length === 1 && items[0].qty > 1) return true;
  return false;
}

function toIntentResult(items, partySize, rawText, parsedBy, confidence, operation) {
  const result = {
    items: items.map(i => ({
      name: stripPoliteSuffix(i.rawName ?? i.name),
      qty: i.qty ?? 1,
      ...(i.menuItemId ? { menuItemId: i.menuItemId } : {}),
      ...(i.selections ? { selections: i.selections } : {}),
      ...(i.removeAll ? { removeAll: true } : {}),
    })),
    partySize,
    rawText,
    parsedBy,
  };
  if (confidence != null) result.confidence = confidence;
  const op = operation ? String(operation).toLowerCase() : 'add';
  if (op !== 'add') result.operation = op;
  return result;
}

function parseIntent(text) {
  const rawText = sanitizeIntentText(text);
  const partySize = extractPartySize(rawText);
  let stripped = stripPartySizePhrases(rawText);
  stripped = stripOrderTypePrefix(stripped);
  stripped = stripPolitePrefix(stripped);
  stripped = stripContinuationPrefix(stripped);
  stripped = stripTurkishDahaSuffix(stripped);
  stripped = stripImperativePrefix(stripped);

  const jeweils = extractJeweilsDrink(stripped);
  if (jeweils) stripped = jeweils.main;

  // "… zum trinken cola" → split drink out before conjunction parsing so
  // beilage attachment doesn't absorb the drink into the food item's rawName.
  let zumTrinkenDrink = null;
  if (!jeweils) {
    const zt = extractZumTrinkenDrink(stripped);
    if (zt) {
      stripped = zt.food;
      zumTrinkenDrink = { qty: 1, rawName: zt.drink };
    }
  }

  let items = splitOneWithoutModifier(stripped);
  if (!items?.length) items = splitBeideMitAllemOneSpicy(stripped);
  if (!items?.length && jeweils?.drink && !jeweils.main) {
    items = [{ qty: 1, rawName: jeweils.drink }];
  }
  if (!items?.length) items = parseGermanQtyItems(stripped);
  if (!items?.length) items = parseTurkishQtyItems(stripped);
  if (!items?.length) items = parseFoodDrinkPair(stripped);
  // When "zum trinken X" was pre-split, parseGermanQtyItems returns null for
  // single-item phrases. Try leading-qty parse before the space-separated fallback
  // so "ein X …" becomes [{qty:1, rawName:"X …"}] rather than keeping "ein".
  if (!items?.length && zumTrinkenDrink) {
    const single = parseGermanLeadingQty(stripped);
    if (single?.length) items = single;
  }
  if (!items?.length) items = parseSpaceSeparatedQtyItems(stripped) ?? parseOrderText(stripped);

  if (zumTrinkenDrink && items?.length) {
    items = [...items, zumTrinkenDrink];
  }

  if (jeweils?.drink && items?.length && jeweils.main) {
    const perMeal = foodQtySum(items.filter(i => !isDrinkStem(stripPoliteSuffix(i.rawName ?? ''))));
    items = [...items, { qty: perMeal || items.length, rawName: jeweils.drink }];
  }

  const usedSingleBlobFallback = !items.length
    && stripped.length >= 2
    && !isGreetingOnly(stripped.toLowerCase())
    && !isFreshStartCommand(stripped.toLowerCase())
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
  items = normalizeBeideMitAllemSpicyItems(items);

  return toIntentResult(items, partySize, rawText, 'rules');
}

/** Single line with mit allem / ohne X / mit scharf — rules already captured modifiers. */
function rulesItemHasKnownModifiers(rawName) {
  const raw = rawName ?? '';
  if (!raw.trim()) return false;
  if (wantsAllIncluded(raw)) return true;
  if (parseExclusions(raw).length > 0) return true;
  if (/\b(?:und\s+)?(?:scharf|scharfe|spicy|hot|chili|acili|aci|sharf)\b/i.test(raw)) return true;
  if (/\bund\s+schaf\b/i.test(raw)) return true;
  if (/\bmit\s+[\wäöüÄÖÜß-]+/i.test(raw)) return true;
  return false;
}

/** Remove modifier phrases before multi-item conjunction detection ("mit" ≠ "pizza und cola"). */
function stripModifierConjunctions(text) {
  let s = text ?? '';
  s = s.replace(/\bmit\s+(?:allem|allen|alles)\b/gi, ' ');
  s = s.replace(/\bmit\s+(?:scharf|scharfe|spicy|hot|chili|acili|aci|sharf)\b/gi, ' ');
  s = s.replace(/\bund\s+(?:scharf|scharfe|schaf|sharf)\b/gi, ' ');
  s = s.replace(
    /\b(?:ohne|without|no)\s+[\wäöüÄÖÜß-]+(?:\s+und\s+[\wäöüÄÖÜß-]+)*(?:\s+bitte)?\s*$/i,
    ' ',
  );
  return s.replace(/\s+/g, ' ').trim();
}

/** High = rules split multiple items cleanly; skip LLM. */
function rulesParseQuality(text) {
  const rawText = (text ?? '').trim();
  let stripped = stripPartySizePhrases(rawText);
  stripped = stripOrderTypePrefix(stripped);
  stripped = stripPolitePrefix(stripped);
  stripped = stripContinuationPrefix(stripped);
  stripped = stripTurkishDahaSuffix(stripped);
  stripped = stripImperativePrefix(stripped);

  const jeweils = extractJeweilsDrink(stripped);
  if (jeweils) stripped = jeweils.main;

  let items = splitOneWithoutModifier(stripped);
  if (!items?.length) items = splitBeideMitAllemOneSpicy(stripped);
  if (!items?.length) items = parseGermanQtyItems(stripped);
  if (!items?.length) items = parseFoodDrinkPair(stripped);
  if (jeweils?.drink && items?.length && jeweils.main) {
    const perMeal = foodQtySum(items.filter(i => !isDrinkStem(stripPoliteSuffix(i.rawName ?? ''))));
    items = [...items, { qty: perMeal || items.length, rawName: jeweils.drink }];
  }

  if (splitOneWithoutModifier(stripped)?.length >= 2) return 'high';
  if (splitBeideMitAllemOneSpicy(stripped)?.length >= 2) return 'high';
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
  if (parseFoodDrinkPair(stripped)?.length >= 2) return 'high';
  if (parseSpaceSeparatedQtyItems(stripped)?.length >= 2) return 'high';

  const parsed = parseOrderText(stripped);
  if (parsed.length >= 2) return 'high';
  if (parsed.length === 1 && /\d+\s*x?\s+/i.test(stripped)) return 'high';

  return 'low';
}

function shouldTryLlm(text, rulesIntent, phone, { provider } = {}) {
  if (!canCallLlm(phone, { provider })) return false;
  if (rulesIntentHasModifierSplit(rulesIntent)) return false;
  if (rulesParseQuality(text) === 'high') return false;
  if (rulesIntent.items?.length === 1 && rulesItemHasKnownModifiers(rulesIntent.items[0].name)) {
    return false;
  }
  if (rulesItemsLookSuspicious(rulesIntent.items)) return true;
  if (!rulesIntent.items.length) return true;

  const stripped = stripOrderTypePrefix(stripPartySizePhrases((text ?? '').trim()));
  const hasConjunction = /\b(and|und|ve|mit|with|plus)\b|[,+]/i.test(stripModifierConjunctions(stripped));
  const hasPartySize = rulesIntent.partySize != null;
  const singleBlob = rulesIntent.items.length === 1
    && /\s/.test(stripped)
    && rulesIntent.items[0].name.length > stripped.length * 0.8;

  return hasConjunction || hasPartySize || singleBlob;
}

function mergeLlmIntent(llm, rawText, rulesIntent) {
  const partySize = llm.partySize ?? rulesIntent.partySize ?? null;
  let items = llm.items.map(i => ({
    rawName: i.name,
    qty: i.qty ?? (partySize ? 1 : 1),
    ...(i.menuItemId ? { menuItemId: i.menuItemId } : {}),
  }));

  if (partySize && items.length && items.every(i => i.qty === 1)) {
    items = items.map(i => ({ ...i, qty: 1 }));
  }

  return toIntentResult(items, partySize, rawText, 'llm', llm.confidence);
}

async function parseIntentAsync(text, {
  phone, businessId, menu, rulesOnly = false, skipLearned = false, forceLlm = false,
  model, provider, llmLabel,
} = {}) {
  const rawText = (text ?? '').trim();

  let learned = null;
  if (businessId && !skipLearned) {
    learned = await lookupLearnedIntent(businessId, rawText);
  }

  const structural = detectRemovePhrase(rawText);
  const skipBadAddLearned = structural
    && learned?.items?.length
    && normalizeOperation(learned.operation) === 'add';

  if (learned?.items?.length && !skipBadAddLearned) {
    const rulesCheck = parseIntent(rawText);
    if (!shouldRejectStaleLearnedHit(rawText, learned, rulesCheck)) {
      const storedItems = learned.items;
      let learnedItems = storedItems.map(i => ({
        rawName: i.rawName ?? i.name,
        qty: i.qty,
        menuItemId: i.menuItemId,
        ...(i.selections ? { selections: i.selections } : {}),
      }));
      if (menu?.length) {
        const menuIndex = buildMenuLlmIndex(menu);
        learnedItems = repairIntentItems(learnedItems, menuIndex);
        if (businessId && learnedItemIdsChanged(storedItems, learnedItems)) {
          const textKey = intentLearnKey(rawText);
          void persistReboundLearnedItems(businessId, textKey, learnedItems);
        }
      }
      const result = toIntentResult(
        learnedItems,
        learned.partySize,
        rawText,
        'learned',
        1,
        learned.operation,
      );
      // Observability: seed hit-rate proves the baked-seed traffic win.
      result.learnedFrom = learned.origin === 'seed' ? 'seed' : 'firestore';
      return result;
    }
  }

  if (structural?.rawName) {
    const inner = parseIntent(structural.rawName);
    if (inner.items.length) {
      const suffixRemove = REMOVE_SUFFIX_RE.test(rawText.trim());
      const explicitQty = /^\d+\s+/i.test(structural.rawName.trim());
      const items = suffixRemove
        ? inner.items.map(i => (explicitQty ? i : { ...i, removeAll: true }))
        : inner.items;
      return toIntentResult(items, inner.partySize, rawText, 'rules', 1, 'remove');
    }
  }

  const rulesIntent = parseIntent(text);

  if (rulesOnly) return rulesIntent;
  // Teach-bot "AI" tier sets forceLlm — always call even when rules look strong.
  // Gate uses getCachedLlmRuntimeSelection (sync); do not await Firestore here.
  if (!forceLlm && !shouldTryLlm(text, rulesIntent, phone, { provider })) return rulesIntent;

  const llm = await parseOrderIntentWithLlm(text, { phone, menu, model, provider, llmLabel });
  if (!llm || llm.confidence < 0.6 || !llm.items.length) {
    // Teach-bot "AI" tier: do not silently fall back to rules (looks like AI success).
    if (forceLlm) {
      return {
        items: [],
        partySize: null,
        confidence: 0,
        rawText,
        parsedBy: 'llm',
        llmAttempted: true,
        llmFailed: true,
        llmModel: llmLabel || llm?.llmModel || model,
        llmProvider: llm?.llmProvider || provider,
      };
    }
    return {
      ...rulesIntent,
      llmAttempted: true,
      llmFailed: true,
      llmModel: llmLabel || llm?.llmModel || model,
    };
  }

  if (rulesIntentHasModifierSplit(rulesIntent) && llm.items.length < rulesIntent.items.length) {
    return {
      ...rulesIntent,
      llmAttempted: true,
      llmFailed: true,
      llmModel: llm.llmModel,
    };
  }

  const merged = mergeLlmIntent(llm, rulesIntent.rawText, rulesIntent);
  if (llm.llmModel) merged.llmModel = llm.llmModel;
  if (llm.llmProvider) merged.llmProvider = llm.llmProvider;
  return merged;
}

module.exports = {
  parseIntent,
  parseIntentAsync,
  looksLikeOrderText,
  isStrongOrderText,
  isGreetingOnly,
  isFreshStartCommand,
  extractPartySize,
  rulesParseQuality,
  shouldTryLlm,
  applyJeweilsBasketContext,
  basketMealQty,
  extractBeideMitAllemSpicyDish,
  textLooksLikeBeideMitAllemOneSpicy,
  sanitizeIntentText,
};
