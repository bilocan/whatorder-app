const { matchMenuItem, classifyMenuMatch } = require('./menuMatch');
const { buildMenuTokenIndex } = require('./menuTokenIndex');
const {
  extractModifierKey, normalizeIntentItemName, isModifierOnlyToken,
} = require('./intentModifiers');
const { extractBeideMitAllemSpicyDish, textLooksLikeBeideMitAllemOneSpicy } = require('./intentParser');

/** Un-collapse 2x same dish when customer said beide mit allem, eine extra scharf. */
function expandPerUnitSpicyMatched(matched, rawText) {
  if (matched.length !== 1) return matched;

  const line = matched[0];
  const qty = line.qty ?? 1;
  if (qty < 2) return matched;

  const source = rawText ?? line.rawIntentName ?? '';
  if (!textLooksLikeBeideMitAllemOneSpicy(source)) return matched;

  const dish = extractBeideMitAllemSpicyDish(source);
  if (!dish) return matched;

  const plainName = `${dish} mit allen ohne scharf`;
  const spicyName = `${dish} mit allen und scharf`;
  const { prefilledSelections, ...base } = line;

  return [
    {
      ...base,
      qty: qty - 1,
      rawIntentName: plainName,
      modifierKey: extractModifierKey(plainName),
    },
    {
      ...base,
      qty: 1,
      rawIntentName: spicyName,
      modifierKey: extractModifierKey(spicyName),
    },
  ];
}

function normIng(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function ingredientStem(token) {
  const n = normIng(token);
  if (n.endsWith('n') && n.length > 3) {
    const stripped = n.slice(0, -1);
    if (stripped.length >= 3) return stripped;
  }
  return n;
}

function tokensMatchIngredient(a, b) {
  const x = ingredientStem(a);
  const y = ingredientStem(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/** Tokens after "mit" in a phrase, or a lone ingredient word (e.g. "gouda"). */
function parseMitIngredientTokens(text) {
  const n = normIng(text);
  const mitTail = n.match(/\bmit\s+(.+)$/);
  if (mitTail) {
    return mitTail[1].split(/\s+und\s+/).map(s => s.trim()).filter(Boolean);
  }
  const words = n.split(/\s+/).filter(w => w.length >= 2);
  return words.length === 1 ? words : [];
}

function extractProductMitIngredients(menuItemName) {
  return parseMitIngredientTokens(menuItemName);
}

function collectIntentIngredientTokens(rawIntentNames) {
  const tokens = [];
  for (const name of rawIntentNames) {
    if (/\b(?:ohne|without|no)\b/i.test(name ?? '')) return null;
    tokens.push(...parseMitIngredientTokens(name));
  }
  return [...new Set(tokens.filter(Boolean))];
}

/** True when split lines are ingredient fragments that match a multi-ingredient product name. */
function isProductIngredientSplit(lines) {
  if (!lines?.length || lines.length < 2) return false;

  const productIngs = extractProductMitIngredients(lines[0].name);
  if (productIngs.length < 2) return false;

  const intentIngs = collectIntentIngredientTokens(lines.map(l => l.rawIntentName));
  if (!intentIngs?.length || intentIngs.length < 2) return false;

  return intentIngs.every(ing => productIngs.some(p => tokensMatchIngredient(ing, p)));
}

function mergeProductIngredientSplitLines(matched) {
  if (!matched?.length || matched.length < 2) return matched;

  const out = [];
  let i = 0;
  while (i < matched.length) {
    const line = matched[i];
    const group = [line];
    let j = i + 1;
    while (j < matched.length && matched[j].menuItemId === line.menuItemId) {
      group.push(matched[j]);
      j += 1;
    }

    if (group.length >= 2 && isProductIngredientSplit(group)) {
      const rawIntentName = group.map(g => g.rawIntentName).filter(Boolean).join(' und ');
      const qtyLine = group.find(g => /\bmit\s+/i.test(g.rawIntentName ?? '')) ?? group[0];
      out.push({
        ...group[0],
        qty: qtyLine.qty,
        rawIntentName,
        modifierKey: rawIntentName ? extractModifierKey(rawIntentName) : group[0].modifierKey,
      });
    } else {
      out.push(...group);
    }
    i = j;
  }
  return out;
}

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
    photoUrl: item.photoUrl ?? undefined,
    rawIntentName: intentName,
    modifierKey: intentName ? extractModifierKey(intentName) : undefined,
  };
}

function matchIntentToMenu(intent, menuItems, menuMatch = null, menuTokenIndex = null) {
  const tokenIndex = menuTokenIndex ?? buildMenuTokenIndex(menuItems);
  let matched = [];
  const unmatched = [];
  let disambiguation = null;

  for (let i = 0; i < intent.items.length; i++) {
    const { name, qty, menuItemId } = intent.items[i];

    if (menuItemId) {
      const byId = menuItems.find(m => m.id === menuItemId && m.available !== false);
      if (byId) {
        matched = mergePendingLine(matched, toPendingItem(byId, qty, { rawIntentName: name }));
        continue;
      }
    }

    const matchName = normalizeIntentItemName(name);
    const result = classifyMenuMatch(matchName, menuItems, menuMatch, tokenIndex);

    if (result.type === 'none') {
      if (!isModifierOnlyToken(name)) unmatched.push(name);
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

  matched = mergeProductIngredientSplitLines(matched);

  return { matched, unmatched, disambiguation };
}

function basketMergeKey(item) {
  const note = (item.note ?? '').trim();
  return note ? `${item.name}\0${note}` : item.name;
}

function hydratePendingItems(pending, menuItems) {
  const byId = new Map((menuItems ?? []).map(m => [m.id, m]));
  return (pending ?? []).map(item => {
    const menuItem = item.menuItemId ? byId.get(item.menuItemId) : null;
    if (!menuItem?.optionGroups?.length) return item;
    return { ...item, optionGroups: menuItem.optionGroups };
  });
}

function mergeIntoBasket(basket, items) {
  let result = [...basket];
  for (const item of items) {
    const key = basketMergeKey(item);
    const existing = result.find(i => basketMergeKey(i) === key);
    if (existing) {
      result = result.map(i => (basketMergeKey(i) === key ? { ...i, qty: i.qty + item.qty } : i));
    } else {
      const line = { name: item.name, qty: item.qty, price: item.price };
      const note = (item.note ?? '').trim();
      if (note) line.note = note;
      result.push(line);
    }
  }
  return result;
}

module.exports = {
  matchIntentToMenu,
  mergeIntoBasket,
  mergePendingLine,
  mergePendingItems,
  toPendingItem,
  basketMergeKey,
  hydratePendingItems,
  expandPerUnitSpicyMatched,
};
