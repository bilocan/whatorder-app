const {
  isValidAustrianUid,
  normalizeUid,
  isLegalComplete,
  missingLegalFields,
  normalizeLegal,
  isValidIban,
  normalizeIban,
  isSettlementIbanComplete,
} = require('../legalProfile');

describe('legalProfile', () => {
  test('accepts ATU + 8 digits', () => {
    expect(isValidAustrianUid('ATU81252038')).toBe(true);
    expect(normalizeUid('atu 8125 2038')).toBe('ATU81252038');
  });

  test('rejects bad UID', () => {
    expect(isValidAustrianUid('ATU123')).toBe(false);
    expect(normalizeUid('DE123')).toBeNull();
  });

  test('isLegalComplete requires all required fields + valid UID', () => {
    const good = normalizeLegal({
      legalName: 'Gus Partners GmbH',
      street: 'Kupetzkygasse 16',
      zip: '1220',
      city: 'Wien',
      country: 'AT',
      uid: 'ATU81252038',
    });
    expect(isLegalComplete(good)).toBe(true);
    expect(missingLegalFields({ legalName: 'X' })).toContain('uid');
  });

  test('accepts and normalizes a valid Austrian IBAN', () => {
    expect(isValidIban('AT611904300234573201')).toBe(true);
    expect(normalizeIban('at61 1904 3002 3457 3201')).toBe('AT611904300234573201');
  });

  test('rejects invalid IBANs', () => {
    expect(isValidIban('AT611904300234573200')).toBe(false);
    expect(isValidIban('AT61')).toBe(false);
    expect(normalizeIban('not-an-iban')).toBeNull();
  });

  test('isSettlementIbanComplete is independent of legal.complete', () => {
    expect(isSettlementIbanComplete({ iban: 'AT611904300234573201' })).toBe(true);
    expect(isSettlementIbanComplete({ legalName: 'X', iban: null })).toBe(false);
    expect(isSettlementIbanComplete(null)).toBe(false);
  });
});
