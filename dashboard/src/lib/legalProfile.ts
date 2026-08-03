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

export function isValidAustrianUid(uid: unknown): uid is string {
  return typeof uid === 'string' && /^ATU[0-9]{8}$/.test(uid);
}

export function normalizeUid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const uid = raw.replace(/\s+/g, '').toUpperCase();
  return isValidAustrianUid(uid) ? uid : null;
}

export function normalizeLegal(input: LegalProfileInput = {}): BusinessLegal {
  const source = input ?? {};
  const uid = normalizeUid(source.uid ?? '');

  return {
    legalName: String(source.legalName ?? '').trim(),
    street: String(source.street ?? '').trim(),
    zip: String(source.zip ?? '').trim(),
    city: String(source.city ?? '').trim(),
    country: String(source.country ?? 'AT').trim() || 'AT',
    uid: uid ?? String(source.uid ?? '').replace(/\s+/g, '').toUpperCase(),
    firmenbuchNr: String(source.firmenbuchNr ?? '').trim() || null,
    email: String(source.email ?? '').trim() || null,
    iban: String(source.iban ?? '').replace(/\s+/g, '').toUpperCase() || null,
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
