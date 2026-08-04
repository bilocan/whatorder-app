const { isDrinkCategory, proposedVatRate } = require('../backfillMenuVatRate');

describe('backfillMenuVatRate drink detection', () => {
  test.each(['drinks', 'Drinks', 'Getränke', 'Getraenke', 'getraenke'])(
    'treats %s as a drink category',
    (category) => {
      expect(isDrinkCategory(category)).toBe(true);
    },
  );

  test.each(['Kebap', 'mains', 'Beilagen', '', null, undefined])(
    'does not treat %s as a drink category',
    (category) => {
      expect(isDrinkCategory(category)).toBe(false);
    },
  );

  test('proposedVatRate uses 20 for Getraenke when --drinks-20', () => {
    expect(proposedVatRate({ category: 'Getraenke' }, true)).toBe(20);
    expect(proposedVatRate({ category: 'Kebap' }, true)).toBe(10);
  });

  test('proposedVatRate stays 10 without --drinks-20', () => {
    expect(proposedVatRate({ category: 'Getraenke' }, false)).toBe(10);
  });
});
