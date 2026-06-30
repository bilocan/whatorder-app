const ALL_PHRASES = /\b(mit allem|mit allen|mit alles|alles dabei|everything|with everything|hepsi|komplett|full)\b/i;
const EXCLUDE_RE = /\b(?:ohne|kein(?:e)?|no|without)\s+([\wäöüÄÖÜß-]+)/gi;

function norm(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

function allOptionIds(group) {
  return (group.options ?? []).map(o => o.id);
}

function getDefaultMultiSelection(group) {
  const mode = group.multiDefault ?? 'all';
  if (mode === 'none') return [];
  if (mode === 'custom') {
    const valid = (group.defaultOptionIds ?? [])
      .filter(id => group.options?.some(o => o.id === id));
    return valid.length ? valid : allOptionIds(group);
  }
  return allOptionIds(group);
}

/** TTS / speech-to-text drink mishearings. Only remap standalone drink intents. */
const DRINK_TTS_TYPOS = new Map([
  ['eier', 'ayran'],
  ['eiern', 'ayran'],
  ['einem', 'ayran'], // "ein Ayran" → "ein einem"
]);

const DRINK_TYPO_FILLERS = new Set([
  'bitte', 'noch', 'dazu', 'gerne', 'danke', 'please', 'extra', 'ich',
]);

/** Words that mean a food/drink SKU follows — typo token is an article, not Ayran. */
const FOOD_WORD_RE = /\b(kebap|kebab|kabap|doner|döner|durum|dürüm|pide|pizza|lahmacun|sandwich|burger|box|teller|huhn|hahnchen|hähnchen|chicken|tavuk|falafel|cola|kola|wasser|water|fanta|sprite|bier|beer|ayran|ayram)\b/i;

function drinkTypoTokenWords(rawName) {
  const n = norm((rawName ?? '').trim().replace(/\s+bitte\s*$/i, ''));
  return n.split(/\s+/).filter(Boolean);
}

/** True when the whole line is a misheard drink (e.g. "einem", "eiern noch dazu"), not "einem kebap". */
function isStandaloneDrinkTypoIntent(rawName) {
  const words = drinkTypoTokenWords(rawName);
  if (!words.length || !DRINK_TTS_TYPOS.has(words[0])) return false;
  if (words.length === 1) return true;
  const rest = words.slice(1);
  if (rest.some(w => FOOD_WORD_RE.test(w))) return false;
  return rest.every(w => DRINK_TYPO_FILLERS.has(w));
}

function normalizeIntentItemName(rawName) {
  const cleaned = (rawName ?? '').trim().replace(/\s+bitte\s*$/i, '').trim();
  if (isStandaloneDrinkTypoIntent(rawName)) {
    return DRINK_TTS_TYPOS.get(drinkTypoTokenWords(rawName)[0]);
  }
  return cleaned;
}

function stripIntentModifiers(rawIntentName) {
  let s = (rawIntentName ?? '').trim();
  s = s.replace(/\b(zum mitnehmen|zum essen|takeaway|to go|abholen)\b/gi, ' ');
  s = s.replace(/\bmit (?:allem|allen)\b/gi, ' ');
  s = s.replace(/\bund\s+(?:scharf|scharfe|spicy|hot|chili|acili|aci|schaf|sharf)\b/gi, ' ');
  s = s.replace(/\bmit\s+(?:scharf|scharfe|spicy|hot|chili|acili|aci|sharf)\b/gi, ' ');
  s = s.replace(/\b(?:ohne|without|no)\s+.+$/i, ' ');
  s = s.replace(/\b\d+\s*cm\b/gi, ' ');
  s = s.replace(/\b(familienpizza|familien pizza|grosse pizza|große pizza)\b/gi, ' familienpizza ');
  s = s.replace(/\b(einer|eine|eins)\b/gi, ' ');
  s = s.replace(/\bnoch\b/gi, ' ');
  s = s.replace(/\bdazu\b/gi, ' ');
  s = s.replace(/\bbitte\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Plate/box side choice — "Schnitzel Teller mit Pommes" is not the Pommes SKU. */
const SIDE_CHOICE_DISH_RE = /\b(teller|box|plate|tava)\b/i;
const SIDE_CHOICE_MIT_RE = /\bmit\s+(?:pommes(?:\s+frites)?|reis|frites|rice)\s*$/i;

function stripSideChoiceForMatch(s) {
  if (!SIDE_CHOICE_DISH_RE.test(s)) return s;
  return s.replace(SIDE_CHOICE_MIT_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** Dish name for menu matching — no qty prefix, no modifier phrases. */
function extractDishNameForMatch(rawIntentName) {
  let s = stripIntentModifiers(rawIntentName);
  s = stripSideChoiceForMatch(s);
  s = s.replace(/^\d+\s*x?\s*/i, '').trim();
  s = s.replace(/^(bir|iki|uc|üç|dort|dört|bes|beş|zwei|drei|vier|funf|fünf|sechs)\s+/i, '').trim();
  return s;
}

function extractModifierKey(rawIntentName) {
  const n = norm(rawIntentName ?? '');
  if (!n) return '';

  const exclusions = parseExclusions(rawIntentName);
  if (exclusions.length) return `ohne:${[...exclusions].sort().join(',')}`;

  if (ALL_PHRASES.test(rawIntentName)) {
    return wantsSpicyIncluded(rawIntentName) ? 'mit:allem+scharf' : 'mit:allem';
  }
  if (wantsSpicyIncluded(rawIntentName)) return 'mit:scharf';

  const inclusions = parseMitInclusions(rawIntentName);
  if (inclusions?.length) {
    return `mit:${[...inclusions].map(norm).sort().join(',')}`;
  }

  const mit = n.match(/\bmit\s+([\wäöüß-]+(?:\s+[\wäöüß-]+)?)/);
  if (mit) return `mit:${mit[1]}`;

  return n;
}

/** TTS / STT / typing typos for spicy (inclusion and exclusion). */
const SPICY_TYPOS = new Map([
  // DE: voice writes Schaf for scharf
  ['schaf', 'scharf'],
  ['schaff', 'scharf'],
  ['schaaf', 'scharf'],
  // DE: common typo sharf for scharf
  ['sharf', 'scharf'],
]);

/** Spicy exclusion stems — DE / EN / TR (normalized, no diacritics). */
const SPICY_EXCLUSION_STEMS = [
  'scharf', 'scharfe', 'scharfer',
  'spicy', 'hot', 'chili', 'chilli',
  'aci', 'acili', 'acisiz',
];

const SPICY_LABEL_STEMS = [
  ...SPICY_EXCLUSION_STEMS,
  'scharfe sauce', 'chili sauce', 'hot sauce', 'aci sos', 'acili',
];

function normalizeSpicyToken(token) {
  const n = norm(token);
  return SPICY_TYPOS.get(n) ?? n;
}

function normalizeExclusionToken(token) {
  return normalizeSpicyToken(token);
}

function isSpicyExclusion(ex) {
  const n = normalizeExclusionToken(ex);
  return SPICY_EXCLUSION_STEMS.some(stem => n === stem || n.includes(stem));
}

function isSpicyLabel(label) {
  const n = norm(label);
  return SPICY_LABEL_STEMS.some(stem => n.includes(stem));
}

function isRegularSauceExclusion(ex) {
  if (isSpicyExclusion(ex)) return false;
  const n = norm(ex);
  return n.includes('sauce') || n.includes('sobe') || n === 'soße' || n === 'sosse';
}

function optionExcludedByHint(optionLabel, exclusionTokens) {
  const label = norm(optionLabel);
  for (const raw of exclusionTokens) {
    if (!raw) continue;
    const ex = normalizeExclusionToken(raw);
    if (label === ex || label.includes(ex) || ex.includes(label)) return true;
    if ((ex.includes('zwiebel') || ex === 'onion') && (label.includes('zwiebel') || label.includes('onion'))) return true;
    if ((ex.includes('tomate') || ex === 'tomato') && (label.includes('tomate') || label.includes('tomato'))) return true;
    if ((ex.includes('salat') || ex === 'salad') && (label.includes('salat') || label.includes('salad'))) return true;
    if (isRegularSauceExclusion(ex) && label.includes('sauce') && !isSpicyLabel(label)) return true;
    if (isSpicyExclusion(ex) && isSpicyLabel(label)) return true;
  }
  return false;
}

function optionIncludedByHint(optionLabel, inclusionTokens) {
  const label = norm(optionLabel);
  for (const raw of inclusionTokens) {
    if (!raw) continue;
    const inc = norm(raw);
    if (label === inc || label.includes(inc) || inc.includes(label)) return true;
    if ((inc.includes('zwiebel') || inc === 'onion') && (label.includes('zwiebel') || label.includes('onion'))) return true;
    if ((inc.includes('tomate') || inc === 'tomato') && (label.includes('tomate') || label.includes('tomato'))) return true;
    if ((inc.includes('salat') || inc === 'salad') && (label.includes('salat') || label.includes('salad'))) return true;
    if (isRegularSauceExclusion(inc) && label.includes('sauce') && !isSpicyLabel(label)) return true;
    if (isSpicyExclusion(inc) && isSpicyLabel(label)) return true;
  }
  return false;
}

/** "mit tomaten salad und zwiebel" → ['tomaten', 'salad', 'zwiebel'] */
function parseMitInclusions(rawIntentName) {
  if (wantsAllIncluded(rawIntentName)) return null;
  if (parseExclusions(rawIntentName).length > 0) return null;

  const raw = rawIntentName ?? '';
  const mitTail = raw.match(/\bmit\s+(.+?)(?:\s+bitte)?\s*$/i);
  if (!mitTail) return null;

  let tail = mitTail[1].trim();
  tail = tail.replace(/\s+und\s+(?:scharf|scharfe|schaf|sharf)\s*$/i, '').trim();
  if (/^(?:allem|allen|alles|scharf|scharfe|spicy|hot)$/i.test(tail)) return null;

  const parts = tail.split(/\s+und\s+|\s*,\s*|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;

  const tokens = [];
  for (const part of parts) {
    const words = part.split(/\s+/).filter(w => w.length >= 2);
    if (words.length > 1) {
      for (const word of words) {
        if (!MODIFIER_ONLY_TOKENS.has(norm(word)) && !SPICY_EXCLUSION_STEMS.includes(norm(word))) {
          tokens.push(word);
        }
      }
    } else if (part.length >= 2
      && !MODIFIER_ONLY_TOKENS.has(norm(part))
      && !SPICY_EXCLUSION_STEMS.includes(norm(part))) {
      tokens.push(part);
    }
  }
  return tokens.length ? tokens : null;
}

function parseExclusions(rawIntentName) {
  const tokens = [];
  const raw = rawIntentName ?? '';

  if (/\bacısız\b|\bacisiz\b/i.test(raw)) {
    return ['aci'];
  }

  const ohneTail = raw.match(/\b(?:ohne|without|no)\s+(.+?)(?:\s+bitte)?\s*$/i);
  if (ohneTail) {
    for (const chunk of ohneTail[1].split(/\s+und\s+|\s*,\s*|\s+and\s+/i)) {
      const w = normalizeExclusionToken(chunk.trim());
      if (w.length >= 2) tokens.push(w);
    }
    if (tokens.length) return tokens;
  }

  let m;
  while ((m = EXCLUDE_RE.exec(raw)) !== null) {
    tokens.push(normalizeExclusionToken(m[1]));
  }
  return tokens;
}

function wantsAllIncluded(rawIntentName) {
  return ALL_PHRASES.test(rawIntentName ?? '');
}

/** Standalone token after "und" — not a menu item (e.g. "… mit allem und scharf"). */
function isModifierOnlyToken(token) {
  const n = normalizeSpicyToken(stripPoliteSuffix(token));
  if (!n) return false;
  if (MODIFIER_ONLY_TOKENS.has(n)) return true;
  if (SPICY_EXCLUSION_STEMS.some(stem => n === stem)) return true;
  if (isBeilageModifierToken(n)) return true;
  return false;
}

function stripPoliteSuffix(name) {
  return (name ?? '')
    .replace(/\s+bitte\b[\s"'«»„!.?]*$/i, '')
    .replace(/[\s"'«»„!.?]+$/g, '')
    .trim();
}

/** Explicit spicy inclusion: "mit scharf", "und scharf", "mit allem und scharf", TTS "und schaf". */
function wantsSpicyIncluded(rawIntentName) {
  const raw = rawIntentName ?? '';
  if (textHasSpicyExclusion(raw)) return false;
  return /\b(?:und\s+|mit\s+|extra\s+)?(scharf|scharfe|scharfer|spicy|hot|chili|chilli|acili|aci|sharf)\b/i.test(raw)
    || /\bund\s+schaf\b/i.test(raw);
}

function textHasSpicyExclusion(rawIntentName) {
  return parseExclusions(rawIntentName).some(isSpicyExclusion);
}

const MODIFIER_ONLY_TOKENS = new Set([
  'scharf', 'scharfe', 'scharfer', 'spicy', 'hot', 'chili', 'chilli',
  'aci', 'acili', 'schaf', 'schaff', 'schaaf', 'sharf',
]);

/** Beilage / topping words that can trail "und" after "mit …" (e.g. "mit salad und zwiebel"). */
const BEILAGE_MODIFIER_STEMS = [
  'zwiebel', 'zwiebeln', 'onion',
  'tomate', 'tomaten', 'tomato',
  'salat', 'salad',
  'sauce', 'soße', 'sosse', 'sobe',
  'gurke', 'gurken', 'pickle',
  'kraut', 'ketchup', 'mayo', 'mayonnaise',
];

function isBeilageModifierToken(token) {
  const n = norm(token);
  if (!n) return false;
  return BEILAGE_MODIFIER_STEMS.some(stem => n === stem || n.startsWith(stem) || stem.startsWith(n));
}

function resolveModifierSelections(rawIntentName, optionGroups) {
  if (!rawIntentName?.trim() || !optionGroups?.length) return null;

  const exclusions = parseExclusions(rawIntentName);
  const allIncluded = wantsAllIncluded(rawIntentName);
  const spicyWanted = wantsSpicyIncluded(rawIntentName);
  const inclusions = parseMitInclusions(rawIntentName);
  if (!exclusions.length && !allIncluded && !spicyWanted && !inclusions?.length) return null;

  const selections = {};

  for (const group of optionGroups) {
    if (group.type !== 'multi') continue;

    let ids;
    if (allIncluded) {
      ids = allOptionIds(group);
      if (exclusions.length) {
        ids = ids.filter(id => {
          const opt = group.options?.find(o => o.id === id);
          return opt && !optionExcludedByHint(opt.label, exclusions);
        });
      }
    } else if (exclusions.length) {
      ids = allOptionIds(group).filter(id => {
        const opt = group.options?.find(o => o.id === id);
        return opt && !optionExcludedByHint(opt.label, exclusions);
      });
    } else if (inclusions?.length) {
      ids = allOptionIds(group).filter(id => {
        const opt = group.options?.find(o => o.id === id);
        return opt && optionIncludedByHint(opt.label, inclusions);
      });
    } else if (spicyWanted) {
      ids = [...getDefaultMultiSelection(group)];
      for (const opt of group.options ?? []) {
        if (isSpicyLabel(opt.label) && !ids.includes(opt.id)) ids.push(opt.id);
      }
    } else {
      ids = getDefaultMultiSelection(group);
    }

    if (ids.length || exclusions.length || allIncluded || spicyWanted || inclusions?.length) {
      selections[group.id] = ids;
    }
  }

  return Object.keys(selections).length ? selections : null;
}

function isCustomizationSatisfied(item, selections) {
  for (const group of item.optionGroups ?? []) {
    if (group.type === 'single' && group.required) {
      if (!selections[group.id]) return false;
    }
    if (group.type === 'multi' && group.required) {
      const sel = selections[group.id];
      if (!Array.isArray(sel) || !sel.length) return false;
    }
  }
  return true;
}

function enrichPendingWithModifier(item) {
  if (!item?.rawIntentName) return item;
  const prefilledSelections = resolveModifierSelections(item.rawIntentName, item.optionGroups);
  if (!prefilledSelections) return item;
  return { ...item, prefilledSelections };
}

module.exports = {
  stripIntentModifiers,
  extractDishNameForMatch,
  extractModifierKey,
  normalizeIntentItemName,
  resolveModifierSelections,
  isCustomizationSatisfied,
  enrichPendingWithModifier,
  wantsAllIncluded,
  wantsSpicyIncluded,
  textHasSpicyExclusion,
  isModifierOnlyToken,
  isSpicyLabel,
  parseExclusions,
  parseMitInclusions,
};
