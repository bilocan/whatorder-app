const REQUIRED = ['legalName', 'street', 'zip', 'city', 'country', 'uid'];

function normalizeUid(raw) {
  if (typeof raw !== 'string') return null;
  const uid = raw.replace(/\s+/g, '').toUpperCase();
  return isValidAustrianUid(uid) ? uid : null;
}

function isValidAustrianUid(uid) {
  return typeof uid === 'string' && /^ATU[0-9]{8}$/.test(uid);
}

function normalizeLegal(input = {}) {
  const uid = normalizeUid(input.uid || '');
  return {
    legalName: String(input.legalName || '').trim(),
    street: String(input.street || '').trim(),
    zip: String(input.zip || '').trim(),
    city: String(input.city || '').trim(),
    country: String(input.country || 'AT').trim() || 'AT',
    uid: uid || String(input.uid || '').replace(/\s+/g, '').toUpperCase(),
    firmenbuchNr: String(input.firmenbuchNr || '').trim() || null,
    email: String(input.email || '').trim() || null,
    iban: String(input.iban || '').replace(/\s+/g, '').toUpperCase() || null,
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
  normalizeLegal,
  missingLegalFields,
  isLegalComplete,
  withCompleteFlag,
};
