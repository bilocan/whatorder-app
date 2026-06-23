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

/** TTS / speech-to-text often writes "Eier" for "Ayran". Only remap standalone drink intents. */
const DRINK_TTS_TYPOS = new Map([
  ['eier', 'ayran'],
  ['eiern', 'ayran'],
]);

function normalizeIntentItemName(rawName) {
  const cleaned = (rawName ?? '').trim().replace(/\s+bitte\s*$/i, '').trim();
  const n = cleaned.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const typo = DRINK_TTS_TYPOS.get(n);
  if (typo) return typo;
  return cleaned;
}

function stripIntentModifiers(rawIntentName) {
  let s = (rawIntentName ?? '').trim();
  s = s.replace(/\b(zum mitnehmen|zum essen|takeaway|to go|abholen)\b/gi, ' ');
  s = s.replace(/\bmit (?:allem|allen)\b/gi, ' ');
  s = s.replace(/\bund\s+(?:scharf|scharfe|spicy|hot|chili|acili|aci|schaf)\b/gi, ' ');
  s = s.replace(/\bmit\s+(?:scharf|scharfe|spicy|hot|chili|acili|aci)\b/gi, ' ');
  s = s.replace(/\b(?:ohne|without|no)\s+.+$/i, ' ');
  s = s.replace(/\b\d+\s*cm\b/gi, ' ');
  s = s.replace(/\b(familienpizza|familien pizza|grosse pizza|große pizza)\b/gi, ' familienpizza ');
  s = s.replace(/\b(einer|eine|eins)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Dish name for menu matching — no qty prefix, no modifier phrases. */
function extractDishNameForMatch(rawIntentName) {
  let s = stripIntentModifiers(rawIntentName);
  s = s.replace(/^\d+\s*x?\s*/i, '').trim();
  s = s.replace(/^(bir|iki|uc|üç|dort|dört|bes|beş|zwei|drei|vier|funf|fünf|sechs)\s+/i, '').trim();
  return s;
}

function extractModifierKey(rawIntentName) {
  const n = norm(rawIntentName ?? '');
  if (!n) return '';

  const exclusions = parseExclusions(rawIntentName);
  if (exclusions.length) return `ohne:${[...exclusions].sort().join(',')}`;

  if (ALL_PHRASES.test(rawIntentName)) return 'mit:allem';
  if (wantsSpicyIncluded(rawIntentName)) return 'mit:scharf';

  const mit = n.match(/\bmit\s+([\wäöüß-]+(?:\s+[\wäöüß-]+)?)/);
  if (mit) return `mit:${mit[1]}`;

  return n;
}

/** TTS / STT typos for exclusion words (language-specific mishears). */
const EXCLUSION_TTS_TYPOS = new Map([
  // DE: voice writes Schaf for scharf
  ['schaf', 'scharf'],
  ['schaff', 'scharf'],
  ['schaaf', 'scharf'],
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

function normalizeExclusionToken(token) {
  const n = norm(token);
  return EXCLUSION_TTS_TYPOS.get(n) ?? n;
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
  const n = norm(stripPoliteSuffix(token));
  if (!n) return false;
  if (MODIFIER_ONLY_TOKENS.has(n)) return true;
  return SPICY_EXCLUSION_STEMS.some(stem => n === stem);
}

function stripPoliteSuffix(name) {
  return (name ?? '').replace(/\s+bitte\s*$/i, '').trim();
}

/** Explicit spicy inclusion: "mit scharf", "und scharf", TTS "und schaf". */
function wantsSpicyIncluded(rawIntentName) {
  const raw = rawIntentName ?? '';
  if (wantsAllIncluded(raw)) return false;
  return /\b(?:und\s+|mit\s+|extra\s+)?(scharf|scharfe|scharfer|spicy|hot|chili|chilli|acili|aci)\b/i.test(raw)
    || /\bund\s+schaf\b/i.test(raw);
}

const MODIFIER_ONLY_TOKENS = new Set([
  'scharf', 'scharfe', 'scharfer', 'spicy', 'hot', 'chili', 'chilli',
  'aci', 'acili', 'schaf', 'schaff', 'schaaf',
]);

function resolveModifierSelections(rawIntentName, optionGroups) {
  if (!rawIntentName?.trim() || !optionGroups?.length) return null;

  const exclusions = parseExclusions(rawIntentName);
  const allIncluded = wantsAllIncluded(rawIntentName);
  const spicyWanted = wantsSpicyIncluded(rawIntentName);
  if (!exclusions.length && !allIncluded && !spicyWanted) return null;

  const selections = {};

  for (const group of optionGroups) {
    if (group.type !== 'multi') continue;

    let ids;
    if (allIncluded) {
      ids = allOptionIds(group);
    } else if (exclusions.length) {
      ids = allOptionIds(group).filter(id => {
        const opt = group.options?.find(o => o.id === id);
        return opt && !optionExcludedByHint(opt.label, exclusions);
      });
    } else if (spicyWanted) {
      ids = [...getDefaultMultiSelection(group)];
      for (const opt of group.options ?? []) {
        if (isSpicyLabel(opt.label) && !ids.includes(opt.id)) ids.push(opt.id);
      }
    } else {
      ids = getDefaultMultiSelection(group);
    }

    if (ids.length || exclusions.length || allIncluded || spicyWanted) {
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
  isModifierOnlyToken,
  isSpicyLabel,
  parseExclusions,
};
