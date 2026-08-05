import type { BusinessLegal } from '../types';

export const REQUIRED_LEGAL_FIELDS = [
  'legalName',
  'street',
  'zip',
  'city',
  'country',
  'uid',
] as const;

export type RequiredLegalField = (typeof REQUIRED_LEGAL_FIELDS)[number];
export type LegalProfileInput = Partial<Omit<BusinessLegal, 'complete'>> | null | undefined;

/** ISO 13616 IBAN length by country code (chars including country + check digits). */
const IBAN_LENGTH_BY_COUNTRY: Readonly<Record<string, number>> = {
  AT: 20,
  BE: 16,
  CH: 21,
  DE: 22,
  FR: 27,
  GB: 22,
  IT: 27,
  NL: 18,
};

export function isValidAustrianUid(uid: unknown): uid is string {
  return typeof uid === 'string' && /^ATU[0-9]{8}$/.test(uid);
}

export function normalizeUid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const uid = raw.replace(/\s+/g, '').toUpperCase();
  return isValidAustrianUid(uid) ? uid : null;
}

export function stripIban(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 MOD-97 check. Returns true for a structurally valid IBAN. */
export function isValidIban(iban: unknown): iban is string {
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

export function normalizeIban(raw: unknown): string | null {
  const compact = stripIban(raw);
  return isValidIban(compact) ? compact : null;
}

/** True when legal.iban is a valid IBAN (settlement payout account). Independent of legal.complete. */
export function isSettlementIbanComplete(legal: LegalProfileInput): boolean {
  if (!legal || typeof legal !== 'object') return false;
  return isValidIban(legal.iban);
}

export function normalizeLegal(input: LegalProfileInput = {}): BusinessLegal {
  const source = input ?? {};
  const uid = normalizeUid(source.uid ?? '');
  const ibanCompact = stripIban(source.iban ?? '');

  return {
    legalName: String(source.legalName ?? '').trim(),
    street: String(source.street ?? '').trim(),
    zip: String(source.zip ?? '').trim(),
    city: String(source.city ?? '').trim(),
    country: String(source.country ?? 'AT').trim() || 'AT',
    uid: uid ?? String(source.uid ?? '').replace(/\s+/g, '').toUpperCase(),
    firmenbuchNr: String(source.firmenbuchNr ?? '').trim() || null,
    email: String(source.email ?? '').trim() || null,
    iban: normalizeIban(ibanCompact) || ibanCompact || null,
    complete: false,
  };
}

export function missingLegalFields(legal: LegalProfileInput): RequiredLegalField[] {
  if (!legal || typeof legal !== 'object') return [...REQUIRED_LEGAL_FIELDS];

  return REQUIRED_LEGAL_FIELDS.filter((field) => {
    if (field === 'uid') return !isValidAustrianUid(legal.uid);
    return !String(legal[field] ?? '').trim();
  });
}

export function isLegalComplete(legal: LegalProfileInput): boolean {
  return missingLegalFields(legal).length === 0;
}

export function withCompleteFlag(legal: LegalProfileInput): BusinessLegal {
  const normalized = normalizeLegal(legal);
  normalized.complete = isLegalComplete(normalized);
  if (normalized.complete) {
    normalized.uid = normalizeUid(normalized.uid) ?? normalized.uid;
  }
  return normalized;
}
