const { matchMenuItem, classifyMenuMatch } = require('./menuMatch');

function toPendingItem(item, qty) {
  return {
    menuItemId: item.id,
    name: item.name,
    qty: Math.min(99, Math.max(1, qty ?? 1)),
    price: Number(item.price),
    optionGroups: item.optionGroups ?? [],
  };
}

function matchIntentToMenu(intent, menuItems) {
  const matched = [];
  const unmatched = [];
  let disambiguation = null;

  for (let i = 0; i < intent.items.length; i++) {
    const { name, qty } = intent.items[i];
    const result = classifyMenuMatch(name, menuItems);

    if (result.type === 'none') {
      unmatched.push(name);
      continue;
    }

    if (result.type === 'unique') {
      matched.push(toPendingItem(result.item, qty));
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

module.exports = { matchIntentToMenu, mergeIntoBasket };
