const { enrichPendingWithModifier, isSpicyLabel } = require('./intentModifiers');
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
  return /\b(?:und\s+|mit\s+|extra\s+)?(scharf|scharfe|scharfer|spicy|hot|chili|chilli|acili|aci)\b/i.test(raw)
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

/** When spicy is requested but no menu insert covers it — prefill checkout notes. */
function collectSpicySpecialNote(rawText, matchedItems, lang = 'de') {
  if (!hasExplicitSpicyInText(rawText)) return null;
  if ((matchedItems ?? []).some(spicyResolvedInItem)) return null;
  return SPICY_NOTE_BY_LANG[lang] ?? SPICY_NOTE_BY_LANG.de;
}

function tagLinesWithNote(items, note) {
  return (items ?? []).map(i => {
    const line = { name: i.name, qty: i.qty, price: i.price };
    const lineNote = combineLineNotes(i, note);
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
  spicyResolvedInItem,
  collectSpicySpecialNote,
  appendSpecialRequest,
  tagLinesWithNote,
  toBasketLine,
  rawIntentLineNote,
  combineLineNotes,
};
