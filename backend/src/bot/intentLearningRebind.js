/**
 * Re-resolve learned phrase items to current menu SKUs when menuItemIds are stale.
 */

const { classifyMenuMatch } = require('./menuMatch');
const { buildMenuTokenIndex } = require('./menuTokenIndex');
const { buildMenuMatchIndex } = require('./menuMapper');

function rebindLearnedItemToMenu(item, menuItems, menuMatch, menuTokenIndex) {
  const id = String(item.menuItemId ?? '').trim();
  if (id && menuItems.some((m) => m.id === id && m.available !== false)) {
    return item;
  }

  const label = String(item.rawName ?? item.name ?? '').trim();
  if (!label) return item;

  const match = classifyMenuMatch(label, menuItems, menuMatch, menuTokenIndex);
  if (match.type !== 'unique') {
    const { menuItemId, ...rest } = item;
    return rest;
  }

  return {
    ...item,
    name: match.item.name,
    menuItemId: match.item.id,
    rawName: item.rawName ?? item.name,
  };
}

function rebindLearnedItemsToMenu(items, menuItems, menuMatch = null) {
  if (!items?.length || !menuItems?.length) return items ?? [];

  const matchIndex = menuMatch ?? buildMenuMatchIndex(menuItems);
  const tokenIndex = buildMenuTokenIndex(menuItems);

  return items.map((item) => rebindLearnedItemToMenu(
    item,
    menuItems,
    matchIndex,
    tokenIndex,
  ));
}

function learnedItemIdsChanged(before, after) {
  if (!before?.length || !after?.length || before.length !== after.length) return true;
  return after.some((item, idx) => (
    String(item.menuItemId ?? '') !== String(before[idx]?.menuItemId ?? '')
  ));
}

module.exports = {
  rebindLearnedItemToMenu,
  rebindLearnedItemsToMenu,
  learnedItemIdsChanged,
};
