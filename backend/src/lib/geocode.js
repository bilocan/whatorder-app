const { isConfigured, geocodeForward: googleForward, geocodeReverse: googleReverse, validateAddress: googleValidate } = require('./googleMaps');
const { isNearlySameAddress, isDeliverableBuildingLabel } = require('../bot/deliveryAddress');

/** Drop city-only / street-without-house geocode hits — not deliverable. */
function acceptDeliverable(result) {
  if (!result?.formattedAddress) return null;
  if (!isDeliverableBuildingLabel(result.formattedAddress)) return null;
  return result;
}

async function nominatimReverse(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WhatOrder/1.0 (contact@whatorder.app)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.display_name ?? null;
  } catch {
    return null;
  }
}

async function nominatimForward(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&addressdetails=1&limit=1&countrycodes=at`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WhatOrder/1.0 (restaurant management)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    const hit = data[0];
    const a = hit.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    const locality = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(' ');
    const shortLabel = [street, locality].filter(Boolean).join(', ');
    return {
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      formattedAddress: shortLabel || hit.display_name || null,
    };
  } catch {
    return null;
  }
}

async function reverseGeocode(lat, lng) {
  if (isConfigured()) {
    try {
      const google = await googleReverse(lat, lng);
      if (google) return google;
    } catch { /* fall through */ }
  }
  return nominatimReverse(lat, lng);
}

async function forwardGeocode(address) {
  if (!address?.trim()) return null;
  if (isConfigured()) {
    try {
      const google = await googleForward(address);
      if (google) return google;
    } catch { /* fall through */ }
  }
  return nominatimForward(address);
}

/**
 * Resolve a typed delivery address to a normalized building label.
 * Prefer Address Validation → Geocoding formatted → Nominatim.
 * FIX verdicts: use Google's suggestion when it differs from input; else fall through.
 * Unconfirmed postal_code: Validation often keeps the user's wrong PLZ (e.g. 1110 vs 1220);
 * fall through to Geocoding which snaps to the real premise PLZ.
 */
async function validateDeliveryAddress(address) {
  if (!address?.trim()) return null;

  if (isConfigured()) {
    try {
      const validated = await googleValidate(address);
      if (validated?.formattedAddress) {
        const postalUnconfirmed = (validated.unconfirmedComponentTypes || []).includes('postal_code');
        if (postalUnconfirmed) {
          // Keep going — Geocoding usually corrects PLZ for the matched premise.
        } else if (validated.possibleNextAction !== 'FIX') {
          const ok = acceptDeliverable(validated);
          if (ok) return ok;
        } else if (!isNearlySameAddress(address, validated.formattedAddress)) {
          // FIX with a real suggestion (not an echo) — still useful for confirm UX.
          const ok = acceptDeliverable({ ...validated, possibleNextAction: 'CONFIRM' });
          if (ok) return ok;
        }
      }
    } catch { /* fall through */ }

    try {
      const geocoded = await googleForward(address);
      const ok = acceptDeliverable(geocoded && {
        formattedAddress: geocoded.formattedAddress,
        lat: geocoded.lat,
        lng: geocoded.lng,
        possibleNextAction: 'CONFIRM',
        hasReplacedComponents: true,
        hasInferredComponents: false,
      });
      if (ok) return ok;
    } catch { /* fall through */ }
  }

  try {
    const nominatim = await nominatimForward(address);
    const ok = acceptDeliverable(nominatim && {
      formattedAddress: nominatim.formattedAddress,
      lat: nominatim.lat,
      lng: nominatim.lng,
      possibleNextAction: 'CONFIRM',
      hasReplacedComponents: true,
      hasInferredComponents: false,
    });
    if (ok) return ok;
  } catch { /* ignore */ }

  return null;
}

module.exports = {
  reverseGeocode,
  forwardGeocode,
  validateDeliveryAddress,
  nominatimReverse,
  nominatimForward,
};
