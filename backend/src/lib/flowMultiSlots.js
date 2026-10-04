/**
 * Plan WhatsApp Flow CheckboxGroup slots from menu multi option groups.
 * Meta hard-limits each CheckboxGroup data-source to 20 options.
 *
 * Any multi list longer than 20 is paginated into one CheckboxGroup
 * (Weitere / Zurück). That keeps a second multi group (e.g. Sonderwunsch)
 * on multi2, and lets capped lists share one maxSelect control.
 */

const { MULTI_SELECT_CAP } = require('./optionSelectBounds');

const FLOW_MULTI_SLOT_COUNT = 3;

function multiGroupsFromItem(item, limit = FLOW_MULTI_SLOT_COUNT) {
  return (item?.optionGroups ?? []).filter((g) => g.type === 'multi').slice(0, limit);
}

/** First multi group that needs pagination (> optionCap options). */
function firstOverflowMultiGroup(optionGroups, optionCap = MULTI_SELECT_CAP) {
  return (optionGroups ?? []).find(
    (g) => g.type === 'multi' && (g.options?.length || 0) > optionCap,
  ) || null;
}

/**
 * Map Flow multi slot index → page number into planFlowMultiSlots pageByGroupId.
 * Slot pages apply only to groups that actually paginate.
 */
function pageByGroupIdForSlots(optionGroups, pagesBySlot = {}, optionCap = MULTI_SELECT_CAP) {
  const base = planFlowMultiSlots(optionGroups, { optionCap, pageByGroupId: {} });
  const pageByGroupId = {};
  base.forEach((slot, i) => {
    if (!slot.paginate) return;
    const page = Number(pagesBySlot[i]) || 1;
    pageByGroupId[slot.group.id] = page;
  });
  return pageByGroupId;
}

/**
 * @param {object[]} optionGroups
 * @param {{ maxSlots?: number, optionCap?: number, pageByGroupId?: Record<string, number> }} [opts]
 * @returns {Array<object>}
 */
function planFlowMultiSlots(optionGroups, {
  maxSlots = FLOW_MULTI_SLOT_COUNT,
  optionCap = MULTI_SELECT_CAP,
  pageByGroupId = {},
} = {}) {
  const multis = (optionGroups ?? []).filter((g) => g.type === 'multi');
  const slots = [];

  for (const group of multis) {
    const opts = group.options ?? [];
    if (!opts.length) continue;
    if (slots.length >= maxSlots) return slots;

    if (opts.length > optionCap) {
      const pageCount = Math.ceil(opts.length / optionCap);
      const requested = Number(pageByGroupId[group.id]) || 1;
      const page = Math.min(pageCount, Math.max(1, Math.floor(requested)));
      const start = (page - 1) * optionCap;
      slots.push({
        group,
        options: opts.slice(start, start + optionCap),
        allOptions: opts,
        paginate: true,
        page,
        pageCount,
        part: page,
        parts: pageCount,
      });
      continue;
    }

    slots.push({
      group,
      options: opts,
      paginate: false,
      part: null,
      parts: null,
    });
  }

  return slots;
}

function normalizeMultiPayload(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (raw) return [String(raw)];
  return [];
}

function uniqueIds(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const s = String(id);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Keep only ids that exist on the group (full catalog, not just the visible page). */
function filterIdsToGroupOptions(groupOrSlot, ids) {
  // Planned slot: allOptions; else group.options / bare options list.
  const list = groupOrSlot?.allOptions
    ?? groupOrSlot?.group?.options
    ?? groupOrSlot?.options
    ?? [];
  const allow = new Set(list.map((o) => String(o.id)));
  return uniqueIds(normalizeMultiPayload(ids).filter((id) => allow.has(String(id))));
}

/**
 * Merge CheckboxGroup payloads.
 * `parkedByGroupId` maps group id → ids parked off the current page.
 * Legacy: (parkedIds array, parkedGroupId string) still accepted.
 * Unknown option ids are dropped (exact-N cannot be satisfied with fakes).
 */
function selectionsFromPlannedMultiSlots(
  plannedSlots,
  payload,
  valueKeys,
  parkedByGroupId = {},
  legacyParkedGroupId = null,
) {
  let parkedMap = parkedByGroupId;
  if (Array.isArray(parkedByGroupId)) {
    parkedMap = {};
    if (legacyParkedGroupId) parkedMap[legacyParkedGroupId] = parkedByGroupId;
    else {
      // Apply to every paginated slot (legacy single-overflow callers).
      plannedSlots.forEach((slot) => {
        if (slot.paginate) parkedMap[slot.group.id] = parkedByGroupId;
      });
    }
  }
  const byGroup = {};
  plannedSlots.forEach((slot, i) => {
    const key = valueKeys[i];
    if (!key) return;
    const vals = filterIdsToGroupOptions(slot, payload[key]);
    const id = slot.group.id;
    if (!byGroup[id]) byGroup[id] = [];
    byGroup[id].push(...vals);
    if (slot.paginate && parkedMap[id]) {
      byGroup[id].push(...filterIdsToGroupOptions(slot, parkedMap[id]));
    }
  });
  for (const id of Object.keys(byGroup)) {
    byGroup[id] = uniqueIds(byGroup[id]);
  }
  return byGroup;
}

/** Prefill one Flow slot from stored group selections (ids on this page only). */
function chunkSelection(slot, selectedIds) {
  const want = new Set(normalizeMultiPayload(selectedIds));
  if (!want.size) return [];
  return (slot.options ?? []).map((o) => String(o.id)).filter((id) => want.has(id));
}

/** Ids selected for a group that are not on the current paginated page. */
function parkSelectionsOffPage(slot, selectedIds) {
  if (!slot?.paginate) return [];
  const onPage = new Set((slot.options ?? []).map((o) => String(o.id)));
  return normalizeMultiPayload(selectedIds).filter((id) => !onPage.has(id));
}

/**
 * max-selected-items for the visible CheckboxGroup page (capped groups).
 * Unlimited overflow pages always use Meta's 20 cap.
 * Meta requires max-selected-items > 1:
 *   remaining 0 → return 2 and disable the group
 *   remaining 1 → caller hides CheckboxGroup and shows RadioButtonsGroup (MULTI_ONE_*)
 */
function pageMaxSelectedItems(maxSelect, parkedCount) {
  if (maxSelect == null) return MULTI_SELECT_CAP;
  const remaining = Math.max(0, maxSelect - parkedCount);
  if (remaining <= 1) return 2;
  return Math.min(MULTI_SELECT_CAP, remaining);
}

/** True when exactly one more pick is allowed (capped groups; Meta forbids max=1). */
function needsMultiOnePick(maxSelect, parkedCount) {
  if (maxSelect == null) return false;
  return Math.max(0, maxSelect - parkedCount) === 1;
}

/**
 * Next page for a paginated slot. Advances forward; on the last page wraps to 1
 * so lists with 3+ pages are never stuck oscillating on the last two pages.
 */
function nextWrappedPage(page, pageCount) {
  const cur = Math.max(1, Number(page) || 1);
  const total = Math.max(1, Number(pageCount) || 1);
  if (cur >= total) return 1;
  return cur + 1;
}

module.exports = {
  FLOW_MULTI_SLOT_COUNT,
  MULTI_SELECT_CAP,
  multiGroupsFromItem,
  firstOverflowMultiGroup,
  pageByGroupIdForSlots,
  planFlowMultiSlots,
  normalizeMultiPayload,
  selectionsFromPlannedMultiSlots,
  filterIdsToGroupOptions,
  chunkSelection,
  parkSelectionsOffPage,
  pageMaxSelectedItems,
  needsMultiOnePick,
  nextWrappedPage,
  uniqueIds,
};
