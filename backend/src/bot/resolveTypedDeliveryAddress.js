const { validateDeliveryAddress } = require('../lib/geocode');
const {
  splitStreetAndUnitHint,
  isDeliverableBuildingLabel,
  normalizeBuildingLabel,
  composeDeliveryLabel,
  isNearlySameAddress,
} = require('./deliveryAddress');

/**
 * Resolve a typed delivery address to a normalized building label (+ optional unit).
 * Shared by chat checkout and Flow manage Speichern.
 */
async function resolveTypedDeliveryAddress(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return { ok: false };

  const { query, unitHint } = splitStreetAndUnitHint(trimmed);

  // Try building-only first; add Wien when locality missing (AT pilot default).
  const hasLocality = /\b(wien|vienna|\d{4})\b/i.test(query);
  const candidates = [];
  const push = (c) => {
    if (c && !candidates.includes(c)) candidates.push(c);
  };
  push(query);
  if (!hasLocality) push(`${query}, Wien`);
  if (query !== trimmed) push(trimmed);
  if (query !== trimmed && !/\b(wien|vienna|\d{4})\b/i.test(trimmed)) {
    push(`${query}, Wien`);
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

/**
 * Confirm when building was corrected OR when customer omitted PLZ.
 * With PLZ present and label nearly identical, skip Yes/Edit (Wien optional).
 * Without PLZ always confirm — Wien alone is not enough (ambiguous Hauptstraße).
 */
function shouldConfirmDeliveryBuilding(rawInput, normalizedLabel) {
  const inputHasPlz = /\b\d{4}\b/.test(String(rawInput || ''));
  if (rawInput && inputHasPlz && isNearlySameAddress(rawInput, normalizedLabel)) {
    return false;
  }
  return true;
}

module.exports = {
  resolveTypedDeliveryAddress,
  shouldConfirmDeliveryBuilding,
};
