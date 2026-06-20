const { matchMenuItem } = require('./menuMatch');

function matchIntentToMenu(intent, menuItems) {
  const matched = [];
  const unmatched = [];

  for (const { name, qty } of intent.items) {
    const item = matchMenuItem(name, menuItems);
    if (item) {
      matched.push({
        menuItemId: item.id,
        name: item.name,
        qty: Math.min(99, Math.max(1, qty ?? 1)),
        price: Number(item.price),
        optionGroups: item.optionGroups ?? [],
      });
    } else {
      unmatched.push(name);
    }
  }

  return { matched, unmatched };
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
