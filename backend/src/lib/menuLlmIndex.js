/** Compact menu index for menu-constrained LLM intent parsing (Design 2). */

const MAX_MENU_LLM_ITEMS = parseInt(process.env.LLM_MENU_MAX_ITEMS || '100', 10);

function compactCategory(category) {
  const c = String(category ?? '').trim();
  if (!c) return '';
  return c.length > 24 ? `${c.slice(0, 22)}..` : c;
}

/**
 * Build numbered menu block for LLM system/user prompt.
 * @param {object[]} menuItems
 * @returns {{ byId: Map<string, object>, promptBlock: string, truncated: boolean }}
 */
function buildMenuLlmIndex(menuItems) {
  const available = (menuItems ?? []).filter(i => i && i.available !== false);
  const truncated = available.length > MAX_MENU_LLM_ITEMS;
  const slice = available.slice(0, MAX_MENU_LLM_ITEMS);

  const byId = new Map();
  const promptLines = slice.map((item, i) => {
    byId.set(item.id, item);
    const cat = compactCategory(item.category);
    const catSuffix = cat ? ` | ${cat}` : '';
    return `${i + 1}. id=${item.id} | ${item.name}${catSuffix}`;
  });

  return {
    byId,
    promptBlock: promptLines.join('\n'),
    truncated,
    count: slice.length,
  };
}

/**
 * Map menu-constrained LLM lines to intent items for matchIntentToMenu.
 * @param {{ menuItemId: string, qty?: number|null, lineText?: string|null }[]} items
 */
function resolveMenuLlmItems(items, menuIndex) {
  if (!items?.length || !menuIndex?.byId) return [];

  const idsInPromptOrder = [...menuIndex.byId.keys()];
  const out = [];
  for (const line of items) {
    let id = String(line?.menuItemId ?? '').trim();
    if (!id) continue;

    // Models often return the 1-based prompt index ("1", "2") instead of the real id.
    if (!menuIndex.byId.has(id)) {
      const n = Number.parseInt(id, 10);
      if (String(n) === id && n >= 1 && n <= idsInPromptOrder.length) {
        id = idsInPromptOrder[n - 1];
      }
    }

    const menuItem = menuIndex.byId.get(id);
    if (!menuItem) continue;

    const lineText = typeof line.lineText === 'string' ? line.lineText.trim() : '';
    const qtyRaw = line.qty;
    const qty = qtyRaw == null ? 1 : Math.min(99, Math.max(1, Number(qtyRaw) || 1));

    out.push({
      name: lineText || menuItem.name,
      qty,
      menuItemId: menuItem.id,
    });
  }
  return out;
}

module.exports = {
  buildMenuLlmIndex,
  resolveMenuLlmItems,
  MAX_MENU_LLM_ITEMS,
};
