const { isConversationalBasket } = require('../featureFlags');

describe('featureFlags', () => {
  describe('isConversationalBasket', () => {
    test('returns false when business is null/undefined', () => {
      expect(isConversationalBasket(null)).toBe(false);
      expect(isConversationalBasket(undefined)).toBe(false);
    });

    test('returns true by default when field is missing', () => {
      expect(isConversationalBasket({})).toBe(true);
      expect(isConversationalBasket({ name: 'Enes' })).toBe(true);
      expect(isConversationalBasket({ conversationalBasket: true })).toBe(true);
    });

    test('returns false only when explicitly opted out', () => {
      expect(isConversationalBasket({ conversationalBasket: false })).toBe(false);
    });
  });
});
