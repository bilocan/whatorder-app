/**
 * Per-district delivery coverage + Mindestbestellwert.
 *
 * `minimumOrderByDistrict` is the SSOT for where a restaurant delivers and the
 * min basket for each PLZ. There is no global fallback minimum.
 */

/** @param {unknown} address */
function extractPostalCode(address) {
  const raw = String(address || '').trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) return raw;
  // Prefer "PLZ City" (Austrian delivery labels); last match wins.
  const withCity = [...raw.matchAll(/\b(\d{4})\s+[A-Za-zÄÖÜäöüß]/g)];
  if (withCity.length) return withCity[withCity.length - 1][1];
  const bare = [...raw.matchAll(/\b(\d{4})\b/g)];
  if (!bare.length) return null;
  return bare[bare.length - 1][1];
}

/**
 * @param {unknown} rows
 * @returns {{ postalCodes: string[], minimumOrderValue: number }[]}
 */
function normalizeMinimumOrderByDistrict(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const min = Number(row.minimumOrderValue);
    if (!Number.isFinite(min) || min < 0) continue;
    const codes = [];
    const seen = new Set();
    const rawCodes = Array.isArray(row.postalCodes)
      ? row.postalCodes
      : String(row.postalCodes || '')
        .split(/[,;\s]+/)
        .filter(Boolean);
    for (const code of rawCodes) {
      const plz = String(code).trim();
      if (!/^\d{4}$/.test(plz)) continue;
      if (seen.has(plz)) continue;
      seen.add(plz);
      codes.push(plz);
    }
    if (!codes.length) continue;
    out.push({ postalCodes: codes, minimumOrderValue: min });
  }
  return out;
}

/** Flatten configured delivery PLZs (order preserved, unique). */
function deliveryPostalCodes(info) {
  const zones = normalizeMinimumOrderByDistrict(info?.minimumOrderByDistrict);
  const out = [];
  const seen = new Set();
  for (const zone of zones) {
    for (const plz of zone.postalCodes) {
      if (seen.has(plz)) continue;
      seen.add(plz);
      out.push(plz);
    }
  }
  return out;
}

/**
 * True when delivery is enabled and the PLZ is listed in district rows.
 * Pickup-only restaurants skip this gate.
 * No district rows configured: unrestricted (legacy flat min still applies in checkout).
 * @param {object|null|undefined} info
 * @param {string|null|undefined} plzOrAddress
 */
function deliversToPostalCode(info, plzOrAddress) {
  if (!info?.deliveryEnabled) return true;
  const zones = normalizeMinimumOrderByDistrict(info.minimumOrderByDistrict);
  if (!zones.length) return true;
  const plz = extractPostalCode(plzOrAddress);
  if (!plz) return false;
  return zones.some((zone) => zone.postalCodes.includes(plz));
}

/**
 * Mindestbestellwert for a known covered PLZ.
 * With district rows: match PLZ only (no global fallback; unknown/out-of-zone → 0).
 * Without district rows: legacy flat `minimumOrderValue`.
 * @param {object|null|undefined} info
 * @param {string|null|undefined} plzOrAddress
 */
function resolveMinimumOrderValue(info, plzOrAddress) {
  const zones = normalizeMinimumOrderByDistrict(info?.minimumOrderByDistrict);
  if (zones.length) {
    const plz = extractPostalCode(plzOrAddress);
    if (!plz) return 0;
    for (const zone of zones) {
      if (zone.postalCodes.includes(plz)) {
        return Number(zone.minimumOrderValue) || 0;
      }
    }
    return 0;
  }
  const legacy = Number(info?.minimumOrderValue);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}

/**
 * PLZ for delivery min/zone.
 * With a typed delivery address: only the address PLZ (never inherit pin).
 * Without an address yet: fall back to session pin PLZ from the multi location share.
 * @param {object|null|undefined} session
 * @param {string|null|undefined} deliveryAddress
 */
function resolveCheckoutPostalCode(session, deliveryAddress) {
  const address = String(deliveryAddress || '').trim();
  if (address) {
    return extractPostalCode(address);
  }
  return extractPostalCode(session?.customerPlz) || null;
}

/**
 * Welcome-copy summary for Liefer-Mindestbestellwert.
 * @returns {null|{ kind: 'single', amount: number }|{ kind: 'byDistrict', rows: { postalCodes: string[], amount: number }[] }}
 */
function summarizeDeliveryMinimumOrders(info) {
  if (!info?.deliveryEnabled) return null;
  const zones = normalizeMinimumOrderByDistrict(info.minimumOrderByDistrict);
  if (zones.length) {
    const positive = zones.filter((z) => z.minimumOrderValue > 0);
    if (!positive.length) return null;
    const amounts = new Set(positive.map((z) => z.minimumOrderValue));
    if (amounts.size === 1) {
      return { kind: 'single', amount: positive[0].minimumOrderValue };
    }
    return {
      kind: 'byDistrict',
      rows: positive.map((z) => ({
        postalCodes: z.postalCodes,
        amount: z.minimumOrderValue,
      })),
    };
  }
  const legacy = Number(info.minimumOrderValue);
  if (Number.isFinite(legacy) && legacy > 0) {
    return { kind: 'single', amount: legacy };
  }
  return null;
}

module.exports = {
  extractPostalCode,
  normalizeMinimumOrderByDistrict,
  deliveryPostalCodes,
  deliversToPostalCode,
  resolveMinimumOrderValue,
  resolveCheckoutPostalCode,
  summarizeDeliveryMinimumOrders,
};
