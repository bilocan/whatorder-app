/** Austrian / common unit markers already present in a free-text address. */
const UNIT_PATTERN = /\b(top|t[uü]r|stiege|stock|apt|apartment|wohnung|#)\b|\//i;

/** Customer says the building has no apartment unit (single-family / street entrance). */
const HAUS_SKIP = new Set([
  'haus', 'house', 'ev', 'bina', 'bina.', 'yok', 'kein', 'keine', 'none', 'n/a', 'na',
]);

function hasUnitPattern(address) {
  return UNIT_PATTERN.test(String(address || ''));
}

function isHausSkip(norm) {
  return HAUS_SKIP.has(String(norm || '').trim());
}

/** Plausible AT unit ranges (Google does not validate apartment interiors). */
const MAX_STIEGE = 40;
const MAX_TOP = 200;

function inUnitRange(n, max) {
  return Number.isInteger(n) && n >= 1 && n <= max;
}

/**
 * Drop unit segments outside AT courier ranges.
 * Google often turns a wrong typed PLZ into a subpremise ("5/1290" or "Top 1290").
 */
function stripOutOfRangeUnits(label) {
  return String(label || '')
    // "Street 5/1290" or "Street 5/3/1290" → keep Hausnummer only when unit is absurd
    .replace(/(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?/g, (match, house, mid, top) => {
      const midN = parseInt(mid, 10);
      if (top != null) {
        const topN = parseInt(top, 10);
        if (!inUnitRange(midN, MAX_STIEGE) || !inUnitRange(topN, MAX_TOP)) return house;
        return match;
      }
      if (!inUnitRange(midN, MAX_TOP)) return house;
      return match;
    })
    .replace(/,?\s*Stiege\s+(\d+)\s*,\s*(?:Top|T[uü]r)\s+(\d+)\b/gi, (match, stiege, top) => {
      const s = parseInt(stiege, 10);
      const t = parseInt(top, 10);
      if (!inUnitRange(s, MAX_STIEGE) || !inUnitRange(t, MAX_TOP)) return '';
      return `, Stiege ${s}, Top ${t}`;
    })
    .replace(/,?\s*(?:Top|T[uü]r)\s+(\d+)\b/gi, (match, top) => {
      const t = parseInt(top, 10);
      if (!inUnitRange(t, MAX_TOP)) return '';
      const kind = /^,?\s*t[uü]r/i.test(match) ? 'Tür' : 'Top';
      return `, ${kind} ${t}`;
    })
    .replace(/,?\s*Stiege\s+(\d+)\b/gi, (match, stiege) => {
      const s = parseInt(stiege, 10);
      if (!inUnitRange(s, MAX_STIEGE)) return '';
      return `, Stiege ${s}`;
    });
}

/** Strip country suffix Google often appends (courier label stays local). */
function normalizeBuildingLabel(address) {
  return stripOutOfRangeUnits(
    String(address || '')
      .replace(/,\s*(Austria|Österreich|Osterreich)\s*$/i, '')
      // Google sometimes returns "Street 11/Stiege 5" — prefer comma form for courier + UI.
      .replace(/\/\s*(stiege|top|t[uü]r)\b/gi, (_, word) => {
        const w = String(word).toLowerCase();
        if (w === 'top') return ', Top';
        if (w === 'tur' || w === 'tür') return ', Tür';
        return ', Stiege';
      }),
  )
    .replace(/,\s*,+/g, ',')
    .replace(/^,\s*/, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when a label is specific enough to deliver to (street + house number).
 * Rejects city-only geocode hits like "Wien" / "Wien, Austria".
 */
function isDeliverableBuildingLabel(address) {
  const label = normalizeBuildingLabel(address);
  if (!label) return false;

  const streetPart = label
    .replace(/,\s*\d{4}\s+[^,]+$/i, '')
    .replace(/,\s*(wien|vienna)\s*$/i, '')
    .trim();

  if (!streetPart) return false;
  if (/^(wien|vienna|österreich|osterreich|austria)$/i.test(streetPart)) return false;
  // Need letters (street) and a digit (Hausnummer)
  if (!/[a-zäöüß]/i.test(streetPart)) return false;
  if (!/\d/.test(streetPart)) return false;
  return true;
}

function composeDeliveryLabel(building, unit) {
  const base = normalizeBuildingLabel(building);
  const u = String(unit || '').trim();
  if (!u || isHausSkip(u.toLowerCase())) return base;
  const parsed = parseDeliveryUnit(u);
  if (!parsed.ok || !parsed.label) return base;
  const label = parsed.label;
  // Insert unit before postal locality when label looks like "Street 11, 1160 Wien"
  const m = base.match(/^(.*?)(,\s*\d{4}\s+.+)$/);
  if (m) return `${m[1].trim()}, ${label}${m[2]}`;
  return `${base}, ${label}`;
}

/**
 * Parse Stiege/Tür/Top (or Haus). Rejects nonsense like bare `9888`.
 * @returns {{ ok: true, label: string|null } | { ok: false }}
 *   label null = Haus (building only)
 */
function parseDeliveryUnit(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false };
  if (isHausSkip(text.toLowerCase())) return { ok: true, label: null };

  let m = text.match(/^\s*stiege\s*(\d+)\s*[,/]?\s*(?:top|t[uü]r)\s*(\d+)\s*$/i);
  if (m) {
    const stiege = parseInt(m[1], 10);
    const top = parseInt(m[2], 10);
    if (!inUnitRange(stiege, MAX_STIEGE) || !inUnitRange(top, MAX_TOP)) return { ok: false };
    return { ok: true, label: `Stiege ${stiege}, Top ${top}` };
  }

  m = text.match(/^\s*(top|t[uü]r)\s*(\d+)\s*$/i);
  if (m) {
    const top = parseInt(m[2], 10);
    if (!inUnitRange(top, MAX_TOP)) return { ok: false };
    const kind = /^t[uü]r$/i.test(m[1]) ? 'Tür' : 'Top';
    return { ok: true, label: `${kind} ${top}` };
  }

  m = text.match(/^\s*stiege\s*(\d+)\s*$/i);
  if (m) {
    const stiege = parseInt(m[1], 10);
    if (!inUnitRange(stiege, MAX_STIEGE)) return { ok: false };
    return { ok: true, label: `Stiege ${stiege}` };
  }

  // 3/12 → Stiege 3, Top 12; 3/5/12 → Stiege 3, Top 12 (stock ignored)
  m = text.match(/^\s*(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?\s*$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const c = m[3] != null ? parseInt(m[3], 10) : null;
    if (c != null) {
      if (!inUnitRange(a, MAX_STIEGE) || !inUnitRange(c, MAX_TOP)) return { ok: false };
      return { ok: true, label: `Stiege ${a}, Top ${c}` };
    }
    if (!inUnitRange(a, MAX_STIEGE) || !inUnitRange(b, MAX_TOP)) return { ok: false };
    return { ok: true, label: `Stiege ${a}, Top ${b}` };
  }

  // Bare number → Top N (courier-friendly); reject absurd values
  m = text.match(/^\s*(\d+)\s*$/);
  if (m) {
    const top = parseInt(m[1], 10);
    if (!inUnitRange(top, MAX_TOP)) return { ok: false };
    return { ok: true, label: `Top ${top}` };
  }

  return { ok: false };
}

function addressKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/strasse|straße/g, 'str')
    .replace(/[^a-z0-9]/g, '');
}

/** Collapse AT unit wording so "3/3/15" and "Stiege 3, Top 15" compare equal. */
function normalizeUnitsForCompare(address) {
  return String(address || '')
    .replace(/\bstiege\s*(\d+)\s*,?\s*top\s*(\d+)/gi, '/$1/$2')
    .replace(/\btür\s*(\d+)/gi, '/$1')
    .replace(/\btop\s*(\d+)/gi, '/$1')
    .replace(/\bstiege\s*(\d+)/gi, '/$1');
}

/** True when two address strings are the same for confirm-skip purposes. */
function isNearlySameAddress(a, b) {
  const ka = addressKey(normalizeUnitsForCompare(a));
  const kb = addressKey(normalizeUnitsForCompare(b));
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // Avoid "panikkengassewien".includes("wien") — only allow substring when both
  // look like street+house (contain a digit) and the shorter key is meaningful.
  if (!/\d/.test(ka) || !/\d/.test(kb)) return false;
  const [shorter, longer] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (shorter.length < 6) return false;
  return longer.includes(shorter);
}

/**
 * Split AT-style "Street 3/3/15", "Street 3/3/15 1220", or "Street 3/3/15, 1220 Wien".
 * Locality may follow with or without a comma; Wien is optional when PLZ is present.
 * Out-of-range slash parts (often a mistyped PLZ) are never treated as Top.
 * @returns {{ query: string, unitHint: string|null }}
 */
function splitStreetAndUnitHint(address) {
  const raw = String(address || '').trim();
  const m = raw.match(
    /^(.*?)\s+(\d+)\s*\/\s*(\d+)(?:\s*\/\s*(\d+))?\s*(?:,\s*|\s+)?(.+)?$/i,
  );
  if (!m) return { query: raw, unitHint: null };

  const street = m[1].trim();
  const house = m[2];
  const mid = parseInt(m[3], 10);
  const top = m[4] != null ? parseInt(m[4], 10) : null;
  let locality = m[5]?.trim() || null;

  let unitHint = null;
  if (top != null) {
    if (inUnitRange(mid, MAX_STIEGE) && inUnitRange(top, MAX_TOP)) {
      unitHint = `Stiege ${mid}, Top ${top}`;
    }
  } else if (inUnitRange(mid, MAX_TOP)) {
    unitHint = `Top ${mid}`;
  } else if (!locality) {
    // "Hauptstrasse 5/1290" — mid is PLZ, not Top
    locality = String(mid);
  } else if (!/\b\d{4}\b/.test(locality)) {
    // "Hauptstrasse 5/1290 Wien"
    locality = `${mid} ${locality}`;
  }
  // else locality already has a PLZ (e.g. Google "5/1290, 1140 Wien") — drop mid

  const building = locality
    ? `${street} ${house}, ${locality}`
    : `${street} ${house}`;

  return {
    query: building.replace(/\s+/g, ' ').trim(),
    unitHint,
  };
}

function splitDeliveryAddressFields(address) {
  const raw = String(address || '').trim();
  if (!raw) return { street: '', apartment: '' };

  const slash = splitStreetAndUnitHint(raw);
  if (slash.unitHint) {
    return { street: slash.query, apartment: slash.unitHint };
  }
  // Out-of-range slash (wrong PLZ as unit) was folded into query — use the clean form.
  if (slash.query !== raw) {
    return { street: slash.query, apartment: '' };
  }

  // ", Stiege N, Top M" before locality
  let m = raw.match(/^(.*?),\s*(Stiege\s+\d+,\s*Top\s+\d+)(,\s*\d{4}\s+.+)?$/i);
  if (m) {
    const street = [m[1].trim(), m[3] ? m[3].replace(/^,\s*/, '') : null].filter(Boolean).join(', ');
    return { street, apartment: m[2].replace(/\s+/g, ' ').trim() };
  }

  // ", Stiege N" before locality (composeDeliveryLabel bare Stiege)
  m = raw.match(/^(.*?),\s*(Stiege\s+\d+)(,\s*\d{4}\s+.+)?$/i);
  if (m) {
    const street = [m[1].trim(), m[3] ? m[3].replace(/^,\s*/, '') : null].filter(Boolean).join(', ');
    return { street, apartment: m[2].replace(/\s+/g, ' ').trim() };
  }

  // ", Top N" or ", Tür N"
  m = raw.match(/^(.*?),\s*((?:Top|Tür|Tur)\s+\d+)(,\s*\d{4}\s+.+)?$/i);
  if (m) {
    const unit = m[2].replace(/^Tur\b/i, 'Tür');
    const street = [m[1].trim(), m[3] ? m[3].replace(/^,\s*/, '') : null].filter(Boolean).join(', ');
    return { street, apartment: unit.replace(/\s+/g, ' ').trim() };
  }

  return { street: raw, apartment: '' };
}

/**
 * Split a courier label into confirm-screen lines (building / unit / locality).
 * Uses the same unit extraction as Flow edit fields.
 */
function formatConfirmAddressDisplay(address) {
  const full = normalizeBuildingLabel(address);
  if (!full) {
    return { label: '', building: '', unit: '', locality: '' };
  }
  const { street, apartment } = splitDeliveryAddressFields(full);
  const streetParts = String(street || full)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const building = streetParts[0] || full;
  const locality = streetParts.slice(1).join(', ');
  return {
    label: full,
    building,
    unit: apartment || '',
    locality,
  };
}

module.exports = {
  hasUnitPattern,
  isHausSkip,
  normalizeBuildingLabel,
  isDeliverableBuildingLabel,
  composeDeliveryLabel,
  parseDeliveryUnit,
  splitStreetAndUnitHint,
  splitDeliveryAddressFields,
  formatConfirmAddressDisplay,
  isNearlySameAddress,
  addressKey,
  UNIT_PATTERN,
  HAUS_SKIP,
  MAX_STIEGE,
  MAX_TOP,
};
