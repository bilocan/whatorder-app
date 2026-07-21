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

/** Strip country suffix Google often appends (courier label stays local). */
function normalizeBuildingLabel(address) {
  return String(address || '')
    .replace(/,\s*(Austria|Österreich|Osterreich)\s*$/i, '')
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
  // Insert unit before postal locality when label looks like "Street 11, 1160 Wien"
  const m = base.match(/^(.*?)(,\s*\d{4}\s+.+)$/);
  if (m) return `${m[1].trim()}, ${u}${m[2]}`;
  return `${base}, ${u}`;
}

/** Plausible AT unit ranges (Google does not validate apartment interiors). */
const MAX_STIEGE = 40;
const MAX_TOP = 200;

function inUnitRange(n, max) {
  return Number.isInteger(n) && n >= 1 && n <= max;
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
  const mid = m[3];
  const top = m[4];
  const locality = m[5]?.trim() || null;
  const unitHint = top
    ? `Stiege ${mid}, Top ${top}`
    : `Top ${mid}`;

  const building = locality
    ? `${street} ${house}, ${locality}`
    : `${street} ${house}`;

  return {
    query: building.replace(/\s+/g, ' ').trim(),
    unitHint,
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
  isNearlySameAddress,
  addressKey,
  UNIT_PATTERN,
  HAUS_SKIP,
  MAX_STIEGE,
  MAX_TOP,
};
