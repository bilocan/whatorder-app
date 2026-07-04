/**
 * Option extra pricing — base menu price + sum of selected option prices.
 */

function parseOptionPrice(raw) {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 100) / 100;
}

function selectedIdsForGroup(selections, groupId) {
  const sel = selections?.[groupId];
  if (!sel) return [];
  return Array.isArray(sel) ? sel : [sel];
}

function sumSelectedOptionPrices(optionGroups, selections) {
  let total = 0;
  for (const group of optionGroups ?? []) {
    for (const optId of selectedIdsForGroup(selections, group.id)) {
      const opt = group.options?.find(o => o.id === optId);
      const extra = parseOptionPrice(opt?.price);
      if (extra != null) total += extra;
    }
  }
  return total;
}

function computeLinePrice(basePrice, optionGroups, selections) {
  const base = Number(basePrice) || 0;
  return Math.round((base + sumSelectedOptionPrices(optionGroups, selections)) * 100) / 100;
}

function linePriceForItem(item, selections) {
  return computeLinePrice(item?.price, item?.optionGroups, selections);
}

/** WhatsApp Flow option titles — max 30 chars including price suffix. */
function formatFlowOptionTitle(label, price) {
  const extra = parseOptionPrice(price);
  const suffix = extra != null ? ` +€${extra.toFixed(2)}` : '';
  const full = `${label}${suffix}`;
  if (full.length <= 30) return full;
  const maxLabel = Math.max(3, 30 - suffix.length);
  return `${label.slice(0, maxLabel - 1)}…${suffix}`;
}

function selectionsFromOrderItemPayload(item, payload, fields) {
  const F = fields;
  const selections = {};
  const singles = (item.optionGroups ?? []).filter(g => g.type === 'single').slice(0, 3);
  const multi = (item.optionGroups ?? []).find(g => g.type === 'multi') ?? null;

  singles.forEach((group, i) => {
    const val = payload[F[`SLOT${i + 1}_VALUE`]];
    if (val) selections[group.id] = val;
  });

  const multiRaw = payload[F.MULTI_VALUE];
  const multiVals = Array.isArray(multiRaw)
    ? multiRaw
    : (multiRaw ? [multiRaw] : []);
  if (multi && multiVals.length) selections[multi.id] = multiVals;

  return selections;
}

module.exports = {
  parseOptionPrice,
  sumSelectedOptionPrices,
  computeLinePrice,
  linePriceForItem,
  formatFlowOptionTitle,
  selectionsFromOrderItemPayload,
};
