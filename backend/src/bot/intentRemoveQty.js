const { basketLineMatchesName } = require('./basketEdit');
const { proposalItemMatchesName } = require('./proposalEdit');

function lineMatchesTarget(line, target) {
  if (target.menuItemId && line.menuItemId === target.menuItemId) return true;
  const needle = target.rawName || target.name;
  return basketLineMatchesName(line, needle) || proposalItemMatchesName(line, needle);
}

/**
 * Remove qty units (or all lines) from basket/proposal lines.
 * @param {object[]} lines
 * @param {{ menuItemId?: string, name?: string, rawName?: string, qty?: number, removeAll?: boolean }} target
 * @returns {object[]|null} null if not enough to remove
 */
function applyRemoveQty(lines, target) {
  const removeAll = !!target.removeAll;
  let remaining = removeAll ? Number.POSITIVE_INFINITY : Math.min(99, Math.max(1, Number(target.qty) || 1));
  const next = [];

  for (const line of lines) {
    if (!lineMatchesTarget(line, target)) {
      next.push(line);
      continue;
    }
    const lineQty = Math.max(1, Number(line.qty) || 1);
    if (removeAll || remaining >= lineQty) {
      remaining -= lineQty;
      continue;
    }
    next.push({ ...line, qty: lineQty - remaining });
    remaining = 0;
  }

  if (Number.isFinite(remaining) && remaining > 0) return null;
  return next;
}

function applyRemoveTargets(lines, targets) {
  let next = lines;
  for (const target of targets) {
    const updated = applyRemoveQty(next, target);
    if (!updated) return null;
    next = updated;
  }
  return next;
}

module.exports = {
  applyRemoveQty,
  applyRemoveTargets,
  lineMatchesTarget,
};
