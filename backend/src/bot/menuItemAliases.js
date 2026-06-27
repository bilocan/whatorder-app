// Auto-generate de/tr/en search aliases for menu SKUs (import + backfill).

const { synonymGroupForToken } = require('./menuSynonyms');
const { norm, normalizeMenuLabel, collapsedMenuLabel, tokensOf } = require('./menuMapper');

const MAX_ITEM_ALIASES = 32;

const SIZE_NOISE_RE = /\b(xxxl|xxl|xl|gross|große|grosse|klein|0[,.]\d+\s*l?|\d+\s*(?:cm|ml|cl))\b/gi;

function stripSizeNoise(label) {
  return normalizeMenuLabel(String(label ?? '').replace(SIZE_NOISE_RE, ' '));
}

/**
 * Build de/tr/en aliases for intent matching from the canonical menu name.
 * Merges manual aliases (dashboard / CSV) without dropping them.
 */
function suggestItemAliases(rawName, { manual = [] } = {}) {
  const display = String(rawName ?? '').trim();
  if (!display) return [];

  const nameNorm = norm(display);
  const aliases = new Set(
    (manual ?? []).map(a => String(a).trim()).filter(Boolean),
  );

  const stripped = stripSizeNoise(display);
  const col = collapsedMenuLabel(display);
  const strippedCol = collapsedMenuLabel(stripped);

  if (stripped && norm(stripped) !== nameNorm) aliases.add(stripped);
  if (col && col !== nameNorm) aliases.add(col);
  if (strippedCol && strippedCol !== nameNorm && strippedCol !== col) aliases.add(strippedCol);

  const tokens = tokensOf(stripped);
  for (let i = 0; i < tokens.length; i++) {
    const group = synonymGroupForToken(tokens[i]);
    if (!group) continue;
    for (const alt of group) {
      if (alt === tokens[i]) continue;
      const swapped = [...tokens];
      swapped[i] = alt;
      aliases.add(swapped.join(' '));
      aliases.add(swapped.join(''));
    }
  }

  const canon = new Set([nameNorm, norm(stripped), col, strippedCol]);
  return [...aliases]
    .filter(a => a && !canon.has(norm(a)))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_ITEM_ALIASES);
}

module.exports = {
  MAX_ITEM_ALIASES,
  stripSizeNoise,
  suggestItemAliases,
};
