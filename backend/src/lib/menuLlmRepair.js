/** Post-LLM repair for menu-constrained intent lines (TTS typos, modifier orphans). */

const { norm } = require('./textNorm');

const SPICY_ORPHAN_TOKENS = new Set([
  'schaf', 'schaff', 'schaaf', 'sharf',
  'scharf', 'scharfe', 'scharfer', 'spicy', 'hot', 'chili', 'chilli', 'acili', 'aci',
]);

const DRINK_ORPHAN_TYPOS = new Map([
  ['eimer', 'ayran'],
  ['eier', 'ayran'],
  ['eiern', 'ayran'],
  ['einem', 'ayran'],
]);

function lineTextOf(line, menuIndex) {
  const raw = typeof line?.lineText === 'string' ? line.lineText.trim() : '';
  if (raw) return raw;
  const item = menuIndex?.byId?.get(line?.menuItemId);
  return item?.name ?? '';
}

function isSpicyOrphanText(text) {
  const t = norm(text);
  return t.length > 0 && SPICY_ORPHAN_TOKENS.has(t);
}

/** Schaf (TTS for scharf) wrongly pinned to Wrap mit Schafskäse. */
function isSchafskaseTrap(lineText, menuItem) {
  const t = norm(lineText);
  if (!['schaf', 'schaff', 'schaaf'].includes(t)) return false;
  return norm(menuItem?.name ?? '').includes('schafskase');
}

function isDrinkItem(menuItem) {
  const cat = norm(menuItem?.category ?? '');
  const name = norm(menuItem?.name ?? '');
  if (cat.includes('getran')) return true;
  return /\b(cola|ayran|fanta|sprite|wasser|bier|eistee|redbull|pepsi|uludag|almdudler)\b/.test(name);
}

function isFoodItem(menuItem) {
  return menuItem && !isDrinkItem(menuItem);
}

function appendSpicyModifier(lineText) {
  const s = (lineText ?? '').trim();
  if (/\b(scharf|schaf|spicy|hot|chili|acili)\b/i.test(s)) return s;
  if (/\bmit\s+(?:allem|allen|alles)\b/i.test(s)) return `${s} und scharf`;
  return s ? `${s} mit scharf` : 'mit scharf';
}

function findDrinkMenuId(menuIndex, drinkStem) {
  const stem = norm(drinkStem);
  for (const item of menuIndex.byId.values()) {
    if (!isDrinkItem(item)) continue;
    const name = norm(item.name);
    if (name.includes(stem)) return item.id;
  }
  return null;
}

/**
 * Fix over-split menu-constrained LLM lines before resolveMenuLlmItems.
 * @param {{ menuItemId: string, qty?: number|null, lineText?: string|null }[]} rawItems
 */
function repairMenuLlmRawItems(rawItems, menuIndex) {
  if (!rawItems?.length || !menuIndex?.byId) return rawItems;

  const out = [];
  for (const line of rawItems) {
    const lineText = typeof line.lineText === 'string' ? line.lineText.trim() : '';
    const menuItem = menuIndex.byId.get(line.menuItemId);
    const prev = out[out.length - 1];
    const prevItem = prev ? menuIndex.byId.get(prev.menuItemId) : null;

    const spicyOrphan = lineText && isSpicyOrphanText(lineText);
    const schafTrap = lineText && isSchafskaseTrap(lineText, menuItem);

    if (prev && prevItem && isFoodItem(prevItem) && (spicyOrphan || schafTrap)) {
      prev.lineText = appendSpicyModifier(lineTextOf(prev, menuIndex));
      continue;
    }

    const drinkTypo = lineText ? DRINK_ORPHAN_TYPOS.get(norm(lineText)) : null;
    if (drinkTypo) {
      const drinkId = findDrinkMenuId(menuIndex, drinkTypo);
      if (drinkId) {
        out.push({ ...line, menuItemId: drinkId, lineText: drinkTypo });
        continue;
      }
    }

    out.push(line);
  }

  return out.length ? out : rawItems;
}

module.exports = {
  repairMenuLlmRawItems,
  isSpicyOrphanText,
  isSchafskaseTrap,
};
