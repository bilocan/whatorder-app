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

/**
 * Small emoji prefix for Flow option titles (mock-style).
 * Match on DE/EN/TR keywords; no match → no emoji.
 */
function optionLabelEmoji(label, id = '') {
  const s = `${label || ''} ${id || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  // Order matters: more specific tokens before broader ones (e.g. dressing before krauter/knoblauch).
  const rules = [
    [/\bohne\b|\bwithout\b/, '🚫'],
    [/doppelboden|doppeltem boden|american pizza/, '🍕'],
    [/ananas|pineapple/, '🍍'],
    [/artischock|artichoke/, '🌿'],
    [/broccoli|brokkoli/, '🥦'],
    [/champignon|pilz|mushroom|mantar/, '🍄'],
    [/kapern|caper/, '🟢'],
    [/melanzan|aubergine|eggplant|patlican/, '🍆'],
    [/rucola|arugula|rocket|spinat|spinach/, '🥬'],
    [/salat|salad|lettuce/, '🥬'],
    [/gurke|cucumber|salatalik/, '🥒'],
    [/zwiebel|onion|sogan/, '🧅'],
    [/tomaten?|tomato/, '🍅'],
    [/paprika|pepper|biber/, '🫑'],
    [/oliv|zeytin/, '🫒'],
    [/mais|corn|misir/, '🌽'],
    // Sauce/dressing before garlic/herbs so "Knoblauch-Dressing" / "Kräuter-Dressing" → jar.
    // 🥣 often missing on older WhatsApp — use 🫙.
    [/sauce|sosse|soße|dressing|specialsauce|cocktailsauce|joghurtsauce|\bsos\b|mayo|ketchup|joghurt|yogurt|ayran/, '🫙'],
    [/basilikum|basil|oregano|\bkrauter\b|\bherb\b/, '🌿'],
    // Wurst/salami before knoblauch so Knoblauchwurst → sausage, not garlic.
    [/salami|wurst|sausage|sucuk/, '🌭'],
    [/knoblauch|garlic|sarimsak/, '🧄'],
    [/schinken|ham|prosciutto|bacon|speck/, '🥓'],
    [/parmesan|osterkron|kaese|kase|cheese|peynir|mozarella|mozzarella/, '🧀'],
    [/pfefferoni|peperoni|pepperoni|scharf|chili|spicy|aci|harissa/, '🌶️'],
    // Reis before Pommes so "Reis oder Pommes" maps to rice. 🍚 often missing on WhatsApp — use 🌾.
    [/reis|rice|pilav|pilaw|pirinc/, '🌾'],
    [/pommes|fries|patates/, '🍟'],
    [/potato|wedges|kartoffel/, '🥔'],
    [/gnocchi|penne|spaghetti|tagliatelle|tortellini|pasta|nudel/, '🍝'],
    [/ei\b|egg|yumurta/, '🥚'],
    [/huhn|chicken|tavuk/, '🍗'],
    [/rind|beef|dana/, '🥩'],
    [/lamm|lamb|kuzu/, '🍖'],
    [/falafel/, '🧆'],
    [/lachs|salmon|salmone/, '🍣'],
    [/shrimp|garnele|prawn|meeresfrucht|seafood/, '🦐'],
    [/sardell|anchov|thunfisch|tuna|fisch|fish|balik/, '🐟'],
    [/staubzucker|\bzucker\b|sugar/, '🍬'],
  ];
  for (const [re, emoji] of rules) {
    if (re.test(s)) return emoji;
  }
  return '';
}

/**
 * WhatsApp Flow option titles — max 30 chars including price suffix.
 * Strip leading "mit " so emoji + name + " +€x.xx" fit (e.g. Pfefferoni mild/scharf).
 */
function formatFlowOptionTitle(label, price, id = '') {
  const raw = label || '';
  const emoji = optionLabelEmoji(raw, id);
  const text = String(raw).replace(/^mit\s+/i, '');
  const named = emoji ? `${emoji} ${text}` : text;
  const extra = parseOptionPrice(price);
  const suffix = extra != null ? ` +€${extra.toFixed(2)}` : '';
  const full = `${named}${suffix}`;
  if (full.length <= 30) return full;
  const maxLabel = Math.max(3, 30 - suffix.length);
  return `${named.slice(0, maxLabel - 1)}…${suffix}`;
}

const {
  FLOW_MULTI_SLOT_COUNT,
  multiGroupsFromItem,
  planFlowMultiSlots,
  normalizeMultiPayload,
  selectionsFromPlannedMultiSlots,
  pageByGroupIdForSlots,
  needsMultiOnePick,
} = require('./flowMultiSlots');
const { resolveSelectBounds } = require('./optionSelectBounds');

function flowMultiValueKeys(fields) {
  return [fields.MULTI_VALUE, fields.MULTI2_VALUE, fields.MULTI3_VALUE];
}

function applyRadioPickIfNeeded(multiPayload, keys, slotIndex, planned, parkedCount, radioValue) {
  const slot = planned[slotIndex];
  if (!slot || !keys[slotIndex]) return;
  const { maxSelect } = resolveSelectBounds(slot.group);
  if (!needsMultiOnePick(maxSelect, parkedCount)) return;
  const one = radioValue == null ? '' : String(radioValue);
  multiPayload[keys[slotIndex]] = one ? [one] : [];
}

function selectionsFromOrderItemPayload(item, payload, fields) {
  const F = fields;
  const selections = {};
  const singles = (item.optionGroups ?? []).filter(g => g.type === 'single').slice(0, 3);

  singles.forEach((group, i) => {
    const val = payload[F[`SLOT${i + 1}_VALUE`]];
    if (val) selections[group.id] = val;
  });

  const pageByGroupId = pageByGroupIdForSlots(item.optionGroups, {
    0: Number(payload[F.MULTI_PAGE]) || 1,
    1: Number(payload[F.MULTI2_PAGE]) || 1,
  });
  const planned = planFlowMultiSlots(item.optionGroups, { pageByGroupId });
  const multiPayload = { ...payload };
  const parked0 = normalizeMultiPayload(payload[F.MULTI_PARKED]);
  const parked1 = normalizeMultiPayload(payload[F.MULTI2_PARKED]);
  const keys = flowMultiValueKeys(F);
  // Only apply radio picks while remaining===1; ignore stale form values otherwise.
  applyRadioPickIfNeeded(multiPayload, keys, 0, planned, parked0.length, payload[F.MULTI_ONE_VALUE]);
  applyRadioPickIfNeeded(multiPayload, keys, 1, planned, parked1.length, payload[F.MULTI2_ONE_VALUE]);
  const parkedByGroupId = {};
  planned.forEach((slot, i) => {
    if (!slot.paginate) return;
    if (i === 0) parkedByGroupId[slot.group.id] = parked0;
    if (i === 1) parkedByGroupId[slot.group.id] = parked1;
  });
  Object.assign(
    selections,
    selectionsFromPlannedMultiSlots(
      planned,
      multiPayload,
      keys,
      parkedByGroupId,
    ),
  );

  return selections;
}

module.exports = {
  parseOptionPrice,
  sumSelectedOptionPrices,
  computeLinePrice,
  linePriceForItem,
  optionLabelEmoji,
  formatFlowOptionTitle,
  normalizeMultiPayload,
  multiGroupsFromItem,
  planFlowMultiSlots,
  FLOW_MULTI_SLOT_COUNT,
  selectionsFromOrderItemPayload,
};
