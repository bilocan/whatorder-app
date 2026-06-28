const { enrichPendingWithModifier, isSpicyLabel, textHasSpicyExclusion } = require('./intentModifiers');
const { norm } = require('./menuMatch');

function rawIntentLineNote(item) {
  const raw = (item?.rawIntentName ?? '').trim();
  if (!raw) return null;
  const name = (item?.name ?? '').trim();
  if (!name) return raw;
  if (norm(raw) === norm(name)) return null;
  return raw;
}

function combineLineNotes(item, globalNote) {
  const parts = [];
  const lineNote = rawIntentLineNote(item);
  const global = (globalNote ?? '').trim();
  if (lineNote) parts.push(lineNote);
  if (global && !parts.some(p => p.toLowerCase().includes(global.toLowerCase()))) {
    parts.push(global);
  }
  return parts.length ? parts.join('; ') : undefined;
}

const SPICY_NOTE_BY_LANG = {
  de: 'extra scharf',
  en: 'extra spicy',
  tr: 'extra acılı',
};

function hasExplicitSpicyInText(text) {
  const raw = text ?? '';
  if (textHasSpicyExclusion(raw)) return false;
  return /\b(?:und\s+|mit\s+|extra\s+)?(scharf|scharfe|scharfer|spicy|hot|chili|chilli|acili|aci|sharf)\b/i.test(raw)
    || /\bund\s+schaf\b/i.test(raw);
}

function spicyResolvedInItem(item) {
  const enriched = enrichPendingWithModifier(item);
  const selections = enriched.prefilledSelections;
  if (!selections) return false;
  for (const group of enriched.optionGroups ?? []) {
    const ids = selections[group.id];
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const opt = group.options?.find(o => o.id === id);
      if (opt && isSpicyLabel(opt.label)) return true;
    }
  }
  return false;
}

function lineWantsSpicy(rawIntentName) {
  const raw = rawIntentName ?? '';
  if (textHasSpicyExclusion(raw)) return false;
  return /\b(?:und\s+|mit\s+|extra\s+)?(scharf|scharfe|scharfer|spicy|hot|chili|chilli|acili|aci|sharf)\b/i.test(raw)
    || /\bund\s+schaf\b/i.test(raw);
}

function countSpicyLines(matchedItems) {
  return (matchedItems ?? []).filter(i => lineWantsSpicy(i.rawIntentName)).length;
}

function resolveLineSpicyNote(item, lang = 'de') {
  if (!lineWantsSpicy(item?.rawIntentName) || spicyResolvedInItem(item)) return null;
  return SPICY_NOTE_BY_LANG[lang] ?? SPICY_NOTE_BY_LANG.de;
}

/** When spicy is requested but no menu insert covers it — prefill checkout notes. */
function collectSpicySpecialNote(rawText, matchedItems, lang = 'de') {
  const items = matchedItems ?? [];
  const spicyLines = countSpicyLines(items);
  if (spicyLines > 0 && spicyLines < items.length) return null;

  if (!hasExplicitSpicyInText(rawText)) return null;
  if (items.some(spicyResolvedInItem)) return null;
  return SPICY_NOTE_BY_LANG[lang] ?? SPICY_NOTE_BY_LANG.de;
}

function tagLinesWithNote(items, note, lang = 'de') {
  return (items ?? []).map(i => {
    const line = { name: i.name, qty: i.qty, price: i.price };
    const perLine = resolveLineSpicyNote(i, lang) ?? ((note ?? '').trim() || null);
    const lineNote = combineLineNotes(i, perLine);
    if (lineNote) line.note = lineNote;
    return line;
  });
}

function toBasketLine({ name, qty, price }, note) {
  const line = { name, qty, price };
  const n = (note ?? '').trim();
  if (n) line.note = n;
  return line;
}

function appendSpecialRequest(existing, addition) {
  const base = (existing ?? '').trim();
  const add = (addition ?? '').trim();
  if (!add) return base || undefined;
  if (!base) return add;
  if (base.toLowerCase().includes(add.toLowerCase())) return base;
  return `${base}; ${add}`;
}

module.exports = {
  hasExplicitSpicyInText,
  lineWantsSpicy,
  resolveLineSpicyNote,
  spicyResolvedInItem,
  collectSpicySpecialNote,
  appendSpecialRequest,
  tagLinesWithNote,
  toBasketLine,
  rawIntentLineNote,
  combineLineNotes,
};
