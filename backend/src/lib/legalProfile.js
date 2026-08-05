const REQUIRED = ['legalName', 'street', 'zip', 'city', 'country', 'uid'];

/** ISO 13616 IBAN length by country code (chars including country + check digits). */
const IBAN_LENGTH_BY_COUNTRY = {
  AT: 20,
  BE: 16,
  CH: 21,
  DE: 22,
  FR: 27,
  GB: 22,
  IT: 27,
  NL: 18,
};

function normalizeUid(raw) {
  if (typeof raw !== 'string') return null;
  const uid = raw.replace(/\s+/g, '').toUpperCase();
  return isValidAustrianUid(uid) ? uid : null;
}

function isValidAustrianUid(uid) {
  return typeof uid === 'string' && /^ATU[0-9]{8}$/.test(uid);
}

function stripIban(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 MOD-97 check. Returns true for a structurally valid IBAN. */
function isValidIban(iban) {
  if (typeof iban !== 'string') return false;
  const compact = stripIban(iban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(compact)) return false;
  const expectedLen = IBAN_LENGTH_BY_COUNTRY[compact.slice(0, 2)];
  if (expectedLen != null && compact.length !== expectedLen) return false;
  if (expectedLen == null && (compact.length < 15 || compact.length > 34)) return false;

  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let expanded = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    expanded += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }

  let remainder = 0;
  for (const digit of expanded) {
    remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

function normalizeIban(raw) {
  const compact = stripIban(raw);
  return isValidIban(compact) ? compact : null;
}

/** True when legal.iban is a valid IBAN (settlement payout account). Independent of legal.complete. */
function isSettlementIbanComplete(legal) {
  if (!legal || typeof legal !== 'object') return false;
  return isValidIban(legal.iban);
}

function normalizeLegal(input = {}) {
  const uid = normalizeUid(input.uid || '');
  const ibanCompact = stripIban(input.iban || '');
  return {
    legalName: String(input.legalName || '').trim(),
    street: String(input.street || '').trim(),
    zip: String(input.zip || '').trim(),
    city: String(input.city || '').trim(),
    country: String(input.country || 'AT').trim() || 'AT',
    uid: uid || String(input.uid || '').replace(/\s+/g, '').toUpperCase(),
    firmenbuchNr: String(input.firmenbuchNr || '').trim() || null,
    email: String(input.email || '').trim() || null,
    iban: normalizeIban(ibanCompact) || ibanCompact || null,
    complete: false, // set below
  };
}

function missingLegalFields(legal) {
  if (!legal || typeof legal !== 'object') return [...REQUIRED];
  const missing = [];
  for (const key of REQUIRED) {
    if (key === 'uid') {
      if (!isValidAustrianUid(legal.uid)) missing.push('uid');
    } else if (!String(legal[key] || '').trim()) {
      missing.push(key);
    }
  }
  return missing;
}

function isLegalComplete(legal) {
  return missingLegalFields(legal).length === 0;
}

function withCompleteFlag(legal) {
  const normalized = normalizeLegal(legal);
  normalized.complete = isLegalComplete(normalized);
  // Keep invalid uid string out of stored uid when normalizing for save — callers may prefer storing draft.
  if (normalized.complete) normalized.uid = normalizeUid(normalized.uid);
  return normalized;
}

module.exports = {
  REQUIRED,
  normalizeUid,
  isValidAustrianUid,
  stripIban,
  isValidIban,
  normalizeIban,
  isSettlementIbanComplete,
  normalizeLegal,
  missingLegalFields,
  isLegalComplete,
  withCompleteFlag,
};
