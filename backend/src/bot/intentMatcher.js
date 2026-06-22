const { matchMenuItem, classifyMenuMatch } = require('./menuMatch');
const { extractModifierKey, normalizeIntentItemName } = require('./intentModifiers');

function pendingMergeKey(item) {
  return `${item.menuItemId}|${item.modifierKey ?? ''}`;
}

function mergePendingLine(matched, pending) {
  const key = pendingMergeKey(pending);
  const existing = matched.find(m => pendingMergeKey(m) === key);
  if (existing) {
    return matched.map(m => (
      pendingMergeKey(m) === key ? { ...m, qty: m.qty + pending.qty } : m
    ));
  }
  return [...matched, pending];
}

function mergePendingItems(items) {
  return (items ?? []).reduce((acc, item) => mergePendingLine(acc, item), []);
}

function toPendingItem(item, qty, { rawIntentName } = {}) {
  const intentName = rawIntentName?.trim() || undefined;
  return {
    menuItemId: item.id,
    name: item.name,
    qty: Math.min(99, Math.max(1, qty ?? 1)),
    price: Number(item.price),
    optionGroups: item.optionGroups ?? [],
    rawIntentName: intentName,
    modifierKey: intentName ? extractModifierKey(intentName) : undefined,
  };
}

function matchIntentToMenu(intent, menuItems) {
  let matched = [];
  const unmatched = [];
  let disambiguation = null;

  for (let i = 0; i < intent.items.length; i++) {
    const { name, qty } = intent.items[i];
    const matchName = normalizeIntentItemName(name);
    const result = classifyMenuMatch(matchName, menuItems);

    if (result.type === 'none') {
      unmatched.push(name);
      continue;
    }

    if (result.type === 'unique') {
      matched = mergePendingLine(matched, toPendingItem(result.item, qty, { rawIntentName: name }));
      continue;
    }

    disambiguation = {
      rawName: name,
      qty: qty ?? 1,
      candidates: result.items,
      resolvedMatched: [...matched],
      unmatchedSoFar: [...unmatched],
      pendingRest: intent.items.slice(i + 1).map(x => ({ name: x.name, qty: x.qty ?? 1 })),
    };
    break;
  }

  return { matched, unmatched, disambiguation };
}

function mergeIntoBasket(basket, items) {
  let result = [...basket];
  for (const item of items) {
    const existing = result.find(i => i.name === item.name);
    if (existing) {
      result = result.map(i => (i.name === item.name ? { ...i, qty: i.qty + item.qty } : i));
    } else {
      result.push({ name: item.name, qty: item.qty, price: item.price });
    }
  }
  return result;
}

module.exports = { matchIntentToMenu, mergeIntoBasket, mergePendingLine, mergePendingItems, toPendingItem };
