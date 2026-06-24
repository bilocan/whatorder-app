const { norm } = require('./menuMatch');
const { parseIntent } = require('./intentParser');
const { formatBasketItemLabel, parseBasketItemName, formatBasketItemBlock } = require('./botHelpers');

const CANCEL_PHRASES = new Set([
  'cancel', 'never mind', 'nevermind', 'forget it',
  'abbrechen', 'vergiss es', 'zurück', 'zuruck',
  'iptal', 'vazgec', 'vazgeç',
]);

const CLEAR_PHRASES = new Set([
  'clear', 'clear all', 'clear basket', 'empty', 'delete all', 'all',
  'alles', 'alle', 'alles löschen', 'alles loschen', 'warenkorb leeren', 'leeren',
  'tümünü sil', 'tumunu sil', 'sepeti temizle', 'hepsini', 'hepsini sil', 'hepsi',
]);

const REMOVE_ALL_PHRASES = new Set([
  'all', 'alle', 'hepsi', 'tümü', 'tumu', 'hepsini',
]);

const REMOVE_BOTH_PHRASES = new Set([
  'both', 'beide', 'ikisi', 'ikisini',
]);

const REMOVE_VERBS =
  'remove|delete|without|no|kein|keine|ohne|entfernen|löschen|loschen|streichen|sil|cikar|çıkar|kaldir|kaldır|weg|raus';
const REMOVE_RE = new RegExp(`^(${REMOVE_VERBS})\\s+(.+)$`, 'i');
const REMOVE_SUFFIX_RE = new RegExp(`^(.+?)\\s+(${REMOVE_VERBS})$`, 'i');
const INDEX_LINE_RE = /^[\d\s,;.+xX×\-undandve]+$/i;
const NAME_SPLIT_RE = /\s*(?:,|und|and|ve|\+)\s*/i;

function basketLineMatchesName(item, rawName) {
  const needle = norm(rawName);
  if (!needle) return false;
  const label = norm(formatBasketItemLabel(item));
  const base = norm(parseBasketItemName(item).baseName);
  return label === needle
    || label.includes(needle)
    || needle.includes(label)
    || base.includes(needle)
    || needle.includes(base);
}

function findMatchingLineIndices(basket, rawName) {
  const indices = [];
  basket.forEach((item, i) => {
    if (basketLineMatchesName(item, rawName)) indices.push(i);
  });
  return indices;
}

function resolveNameFragment(basket, fragment) {
  const indices = findMatchingLineIndices(basket, fragment);
  if (!indices.length) return { status: 'none' };
  if (indices.length === 1) return { status: 'single', index: indices[0] };
  return { status: 'ambiguous', indices: indices.map(i => i + 1), fragment };
}

function collectFragmentParts(trimmed) {
  const parts = trimmed.split(NAME_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts;

  const intent = parseIntent(trimmed);
  if (intent.items.length >= 2) return intent.items.map(i => i.name);

  return [trimmed];
}

function removeLinesMatchingName(basket, rawName) {
  const resolved = resolveNameFragment(basket, rawName);
  if (resolved.status !== 'single') return null;
  return basket.filter((_, i) => i !== resolved.index);
}

function removeBasketByFragment(basket, fragment) {
  const trimmed = (fragment ?? '').trim();
  if (!trimmed) return null;

  const parts = collectFragmentParts(trimmed);
  const toRemove = new Set();

  for (const part of parts) {
    const resolved = resolveNameFragment(basket, part);
    if (resolved.status === 'none') {
      if (parts.length === 1) return null;
      continue;
    }
    if (resolved.status === 'ambiguous') {
      return { ambiguous: true, indices: resolved.indices, fragment: resolved.fragment };
    }
    toRemove.add(resolved.index);
  }

  if (!toRemove.size) return null;
  return basket.filter((_, i) => !toRemove.has(i));
}

function parseLineNumbers(text) {
  const matches = text.match(/\d+/g);
  if (!matches) return [];
  return [...new Set(matches.map(n => parseInt(n, 10)).filter(n => n >= 1))];
}

function parseBasketRemove(text, normText, { allowBareName = false } = {}) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const lower = normText ?? norm(trimmed);
  if (CANCEL_PHRASES.has(lower)) return { type: 'cancel' };
  if (CLEAR_PHRASES.has(lower)) return { type: 'clear' };

  const removeMatch = trimmed.match(REMOVE_RE);
  if (removeMatch) return { type: 'by_name', fragment: removeMatch[2].trim() };

  const removeSuffix = trimmed.match(REMOVE_SUFFIX_RE);
  if (removeSuffix) return { type: 'by_name', fragment: removeSuffix[1].trim() };

  if (INDEX_LINE_RE.test(trimmed) && /\d/.test(trimmed)) {
    const indices = parseLineNumbers(trimmed);
    if (indices.length) return { type: 'by_index', indices };
  }

  if (allowBareName && !/\s/.test(trimmed)) {
    return { type: 'by_name', fragment: trimmed };
  }

  return null;
}

function removeBasketAtIndices(basket, oneBasedIndices) {
  const toRemove = new Set(
    oneBasedIndices.map(n => n - 1).filter(i => i >= 0 && i < basket.length),
  );
  if (!toRemove.size) return null;
  return basket.filter((_, i) => !toRemove.has(i));
}

function applyBasketRemove(basket, edit) {
  if (!edit) return null;

  if (edit.type === 'cancel') return { type: 'cancel', basket };
  if (edit.type === 'clear') return { type: 'clear', basket: [] };

  if (edit.type === 'by_index') {
    const next = removeBasketAtIndices(basket, edit.indices);
    if (!next || next.length === basket.length) return null;
    return { type: 'updated', basket: next };
  }

  if (edit.type === 'by_name') {
    const next = removeBasketByFragment(basket, edit.fragment);
    if (!next) return null;
    if (next.ambiguous) {
      return { type: 'ambiguous', indices: next.indices, fragment: next.fragment };
    }
    return { type: 'updated', basket: next };
  }

  return null;
}

function parseBasketRemoveDisambig(text, normText, disambig) {
  const trimmed = (text ?? '').trim();
  if (!trimmed || !disambig?.indices?.length) return null;

  const lower = normText ?? norm(trimmed);
  if (CANCEL_PHRASES.has(lower)) return { type: 'cancel' };

  const choiceSet = new Set(disambig.indices);
  if (REMOVE_ALL_PHRASES.has(lower)) {
    return { type: 'by_index', indices: [...disambig.indices] };
  }
  if (REMOVE_BOTH_PHRASES.has(lower) && disambig.indices.length === 2) {
    return { type: 'by_index', indices: [...disambig.indices] };
  }

  if (INDEX_LINE_RE.test(trimmed) && /\d/.test(trimmed)) {
    const parsed = parseLineNumbers(trimmed);
    const valid = parsed.filter(n => choiceSet.has(n));
    if (valid.length) return { type: 'by_index', indices: valid };
  }

  return null;
}

function buildBasketRemoveAmbiguousText(basket, oneBasedIndices) {
  return oneBasedIndices
    .map(lineNum => formatBasketItemBlock(basket[lineNum - 1], lineNum))
    .join('\n\n');
}

module.exports = {
  parseBasketRemove,
  parseBasketRemoveDisambig,
  applyBasketRemove,
  removeBasketByFragment,
  removeBasketAtIndices,
  basketLineMatchesName,
  buildBasketRemoveAmbiguousText,
  findMatchingLineIndices,
};
