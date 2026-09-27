const { validateDeliveryAddress } = require('../lib/geocode');
const {
  splitStreetAndUnitHint,
  isDeliverableBuildingLabel,
  normalizeBuildingLabel,
  composeDeliveryLabel,
  formatConfirmAddressDisplay,
  addressKey,
} = require('./deliveryAddress');

/**
 * Resolve a typed delivery address to a normalized building label (+ optional unit).
 * Shared by chat checkout and Flow manage Speichern.
 */
async function resolveTypedDeliveryAddress(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return { ok: false };

  const { query, unitHint } = splitStreetAndUnitHint(trimmed);

  // PLZ alone is not enough locality — "Hauptstrasse 5, 1290" must still try Wien
  // (pilot default) and a PLZ-stripped fallback when the typed PLZ is wrong.
  const hasCity = /\b(wien|vienna)\b/i.test(query);
  const hasPlz = /\b\d{4}\b/.test(query);
  const candidates = [];
  const push = (c) => {
    if (c && !candidates.includes(c)) candidates.push(c);
  };
  push(query);
  if (!hasCity) push(`${query}, Wien`);
  if (query !== trimmed) push(trimmed);
  if (query !== trimmed && !/\b(wien|vienna)\b/i.test(trimmed)) {
    push(`${trimmed}, Wien`);
  }
  if (hasPlz && !hasCity) {
    const withoutPlz = query
      .replace(/,?\s*\b\d{4}\b/g, '')
      .replace(/\s*,\s*,/g, ',')
      .replace(/^,\s*|,\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (withoutPlz && withoutPlz !== query) {
      push(`${withoutPlz}, Wien`);
      push(withoutPlz);
    }
  }

  let validated = null;
  for (const candidate of candidates) {
    validated = await validateDeliveryAddress(candidate);
    if (validated?.formattedAddress && isDeliverableBuildingLabel(validated.formattedAddress)) {
      break;
    }
    validated = null;
  }

  if (!validated?.formattedAddress) {
    console.warn(`[checkout] delivery address unresolved: ${trimmed.slice(0, 80)}`);
    return { ok: false };
  }

  let building = normalizeBuildingLabel(validated.formattedAddress);
  if (unitHint) {
    building = composeDeliveryLabel(building, unitHint);
  }
  return {
    ok: true,
    building,
    lat: validated.lat ?? null,
    lng: validated.lng ?? null,
  };
}

/** Street + house only. PLZ and city are ignored so "Hippgasse 11" matches "Hippgasse 11, 1160 Wien". */
function streetHouseKey(address) {
  const { building } = formatConfirmAddressDisplay(address);
  const line = String(building || '')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/\b(wien|vienna|österreich|osterreich|austria)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return addressKey(line);
}

function postalCode(address) {
  const match = String(address || '').match(/\b(\d{4})\b/);
  return match ? match[1] : '';
}

/**
 * Same street + house can sit in more than one PLZ. Confirm unless the
 * customer already typed a PLZ and it matches the resolved one.
 * Street or house corrections confirm. A typed PLZ that Google replaced
 * confirms (1110 → 1220). Omitting PLZ confirms, so the district is visible.
 */
function shouldConfirmDeliveryBuilding(rawInput, normalizedLabel) {
  const inputKey = streetHouseKey(rawInput);
  const labelKey = streetHouseKey(normalizedLabel);
  if (!inputKey || !labelKey || inputKey !== labelKey) return true;
  const inputPlz = postalCode(rawInput);
  if (!inputPlz) return true;
  const labelPlz = postalCode(normalizedLabel);
  // A label with no PLZ cannot prove the typed district. Confirm.
  if (!labelPlz || inputPlz !== labelPlz) return true;
  return false;
}

module.exports = {
  resolveTypedDeliveryAddress,
  shouldConfirmDeliveryBuilding,
};
