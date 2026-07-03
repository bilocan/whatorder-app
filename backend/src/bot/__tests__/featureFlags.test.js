const { isConversationalBasket } = require('../featureFlags');

describe('featureFlags', () => {
  describe('isConversationalBasket', () => {
    test('returns false when business is null/undefined', () => {
      expect(isConversationalBasket(null)).toBe(false);
      expect(isConversationalBasket(undefined)).toBe(false);
    });

    test('returns false when field is missing or falsy', () => {
      expect(isConversationalBasket({})).toBe(false);
      expect(isConversationalBasket({ name: 'Enes' })).toBe(false);
      expect(isConversationalBasket({ conversationalBasket: false })).toBe(false);
    });

    test('returns true only when conversationalBasket is explicitly true', () => {
      expect(isConversationalBasket({ conversationalBasket: true })).toBe(true);
    });
  });
});
