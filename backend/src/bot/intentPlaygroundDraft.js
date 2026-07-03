const { enrichPendingWithModifier, extractModifierKey } = require('./intentModifiers');
const { buildOptionLabel } = require('./intentCustomize');

function normalizeSelectionsMap(selections) {
  if (!selections || typeof selections !== 'object') return null;
  const out = {};
  for (const [groupId, value] of Object.entries(selections)) {
    if (!groupId) continue;
    if (Array.isArray(value)) {
      const ids = value.map(String).filter(Boolean);
      if (ids.length) out[groupId] = ids;
    } else if (typeof value === 'string' && value) {
      out[groupId] = [value];
    }
  }
  return Object.keys(out).length ? out : null;
}

function applyStoredSelections(pending, selections) {
  const sel = normalizeSelectionsMap(selections);
  if (!sel || !pending?.optionGroups?.length) return pending;
  const label = buildOptionLabel(pending, sel);
  return {
    ...pending,
    prefilledSelections: sel,
    name: label,
    modifierKey: pending.rawIntentName
      ? extractModifierKey(pending.rawIntentName)
      : pending.modifierKey,
  };
}

function normalizeDraftItem(item) {
  if (!item || (!item.menuItemId && !item.name)) return null;
  const out = {
    name: String(item.name ?? '').trim(),
    qty: Math.min(99, Math.max(1, Number(item.qty) || 1)),
    menuItemId: item.menuItemId ? String(item.menuItemId) : undefined,
    removeAll: !!item.removeAll,
  };
  if (item.rawName) out.rawName = String(item.rawName).trim();
  const selections = normalizeSelectionsMap(item.selections);
  if (selections) out.selections = selections;
  if (out.rawName) out.modifierKey = extractModifierKey(out.rawName);
  return out.name || out.menuItemId ? out : null;
}

function normalizeDraftItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeDraftItem).filter(Boolean);
}

function draftToPendingItem(sku, qty, rawIntentName) {
  const intentName = rawIntentName?.trim() || undefined;
  return {
    menuItemId: sku.id,
    name: sku.name,
    qty: Math.min(99, Math.max(1, qty ?? 1)),
    price: Number(sku.price),
    optionGroups: sku.optionGroups ?? [],
    rawIntentName: intentName,
    modifierKey: intentName ? extractModifierKey(intentName) : undefined,
  };
}

function buildMatchedLineFromDraft(draft, menuById) {
  const sku = draft.menuItemId ? menuById.get(draft.menuItemId) : null;
  if (!sku || sku.available === false) return null;
  const rawIntentName = draft.rawName ?? draft.name ?? sku.name;
  let line = draftToPendingItem(sku, draft.qty, rawIntentName);
  if (draft.selections) {
    line = applyStoredSelections(line, draft.selections);
  } else if (rawIntentName && rawIntentName !== sku.name) {
    line = enrichPendingWithModifier(line);
  }
  return line;
}

function slimMatchedLine(line) {
  return {
    name: line.name,
    qty: line.qty ?? 1,
    menuItemId: line.menuItemId ?? null,
    rawIntentName: line.rawIntentName ?? null,
    selections: line.prefilledSelections ?? null,
  };
}

/**
 * Owner draft (add) → matched lines + Verstanden preview.
 */
function buildAddDraftPreview(draftItems, menu, { lang = 'de', unmatched = [] } = {}) {
  const menuById = new Map((menu ?? []).map((m) => [m.id, m]));
  const draft = normalizeDraftItems(draftItems);
  const matched = draft
    .map((d) => buildMatchedLineFromDraft(d, menuById))
    .filter(Boolean);

  if (!matched.length) {
    return {
      outcome: 'no_match',
      operation: 'add',
      matched: [],
      unmatched,
      botReply: null,
    };
  }

  return {
    outcome: 'proposal',
    operation: 'add',
    matched,
    unmatched,
    botReply: require('./intentOrder').buildIntentConfirmBody(matched, unmatched, lang),
  };
}

module.exports = {
  normalizeDraftItems,
  normalizeSelectionsMap,
  applyStoredSelections,
  buildAddDraftPreview,
  slimMatchedLine,
};
