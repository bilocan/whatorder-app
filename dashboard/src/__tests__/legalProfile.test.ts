import { describe, expect, it } from 'vitest';
import {
  isLegalComplete,
  isValidAustrianUid,
  missingLegalFields,
  normalizeUid,
  withCompleteFlag,
} from '../lib/legalProfile';

const completeLegal = {
  legalName: 'Gus Partners GmbH',
  street: 'Kupetzkygasse 16',
  zip: '1220',
  city: 'Wien',
  country: 'AT',
  uid: 'ATU81252038',
};

describe('legalProfile', () => {
  it('accepts and normalizes an Austrian UID', () => {
    expect(isValidAustrianUid('ATU81252038')).toBe(true);
    expect(normalizeUid('atu 8125 2038')).toBe('ATU81252038');
  });

  it('rejects an invalid UID', () => {
    expect(isValidAustrianUid('ATU123')).toBe(false);
    expect(normalizeUid('DE123')).toBeNull();
  });

  it('requires all legal fields and a valid UID', () => {
    expect(isLegalComplete(completeLegal)).toBe(true);
    expect(missingLegalFields({ legalName: 'X' })).toEqual([
      'street',
      'zip',
      'city',
      'country',
      'uid',
    ]);
  });

  it('normalizes values and derives the complete flag', () => {
    expect(
      withCompleteFlag({
        ...completeLegal,
        legalName: '  Gus Partners GmbH ',
        uid: 'atu 8125 2038',
        iban: 'at61 1904 3002 3457 3201',
      }),
    ).toEqual({
      ...completeLegal,
      iban: 'AT611904300234573201',
      firmenbuchNr: null,
      email: null,
      complete: true,
    });
  });
});
