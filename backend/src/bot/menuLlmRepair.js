/** Bot-layer repairIntentItems (uses intent learning rebind). Raw repair lives in lib/menuLlmRepair. */

const {
  repairMenuLlmRawItems,
  isSpicyOrphanText,
  isSchafskaseTrap,
} = require('../lib/menuLlmRepair');
const { resolveMenuLlmItems } = require('../lib/menuLlmIndex');

/**
 * Repair resolved intent items (learned cache replay).
 * @param {{ name: string, qty?: number, menuItemId?: string, rawName?: string }[]} items
 */
function repairIntentItems(items, menuIndex) {
  if (!items?.length || !menuIndex?.byId) return items;

  const selectionsBySku = new Map();
  for (const item of items) {
    if (item.menuItemId && item.selections) {
      selectionsBySku.set(item.menuItemId, item.selections);
    }
  }

  const raw = items.map(i => ({
    menuItemId: i.menuItemId,
    qty: i.qty,
    lineText: (i.rawName ?? i.name ?? '').trim() || null,
  }));

  const repaired = repairMenuLlmRawItems(raw, menuIndex);

  const resolved = resolveMenuLlmItems(repaired, menuIndex).map((line) => ({
    rawName: line.name,
    name: line.name,
    qty: line.qty,
    menuItemId: line.menuItemId,
    ...(selectionsBySku.has(line.menuItemId)
      ? { selections: selectionsBySku.get(line.menuItemId) }
      : {}),
  }));

  if (resolved.length && resolved.length === repaired.length) return resolved;

  const menu = [...menuIndex.byId.values()];
  const { rebindLearnedItemsToMenu } = require('./intentLearningRebind');
  return rebindLearnedItemsToMenu(items, menu);
}

module.exports = {
  repairMenuLlmRawItems,
  repairIntentItems,
  isSpicyOrphanText,
  isSchafskaseTrap,
};
