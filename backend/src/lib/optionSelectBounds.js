/** Meta CheckboxGroup max-selected-items upper bound. */
const MULTI_SELECT_CAP = 20;

function clampSelectCount(n, optionCount) {
  const upper = Math.min(MULTI_SELECT_CAP, Math.max(1, optionCount || 1));
  if (!Number.isFinite(n)) return null;
  return Math.min(upper, Math.max(1, Math.floor(n)));
}

/**
 * Resolve min/max selection bounds for a multi option group.
 * Exact-N stores minSelect === maxSelect.
 */
function resolveSelectBounds(group) {
  const optionCount = (group?.options ?? []).length;
  const hasMin = typeof group?.minSelect === 'number' && Number.isFinite(group.minSelect);
  const hasMax = typeof group?.maxSelect === 'number' && Number.isFinite(group.maxSelect);
  if (!hasMin && !hasMax) {
    return { minSelect: null, maxSelect: null, bounded: false };
  }

  let minSelect = hasMin ? clampSelectCount(group.minSelect, optionCount) : null;
  let maxSelect = hasMax ? clampSelectCount(group.maxSelect, optionCount) : null;
  if (minSelect != null && maxSelect != null && minSelect > maxSelect) {
    maxSelect = minSelect;
  }
  return {
    minSelect,
    maxSelect,
    bounded: minSelect != null || maxSelect != null,
  };
}

function selectionCountOk(group, selectedIds) {
  const { minSelect, maxSelect } = resolveSelectBounds(group);
  const n = Array.isArray(selectedIds) ? selectedIds.length : 0;
  if (minSelect != null && n < minSelect) return false;
  if (maxSelect != null && n > maxSelect) return false;
  return true;
}

function isExactSelectGroup(group) {
  const { minSelect, maxSelect, bounded } = resolveSelectBounds(group);
  return bounded && minSelect != null && maxSelect != null && minSelect === maxSelect;
}

module.exports = {
  MULTI_SELECT_CAP,
  clampSelectCount,
  resolveSelectBounds,
  selectionCountOk,
  isExactSelectGroup,
};
