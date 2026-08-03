const {
  isValidAustrianUid,
  normalizeUid,
  isLegalComplete,
  missingLegalFields,
  normalizeLegal,
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
});
