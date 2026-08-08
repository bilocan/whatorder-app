const { isConversationalBasket, isCheckoutConfirmFlow } = require('../featureFlags');

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

describe('isCheckoutConfirmFlow', () => {
  test('returns false when business is null/undefined', () => {
    expect(isCheckoutConfirmFlow(null)).toBe(false);
    expect(isCheckoutConfirmFlow(undefined)).toBe(false);
  });

  test('returns false by default when field is missing', () => {
    expect(isCheckoutConfirmFlow({})).toBe(false);
    expect(isCheckoutConfirmFlow({ name: 'Enes' })).toBe(false);
  });

  test('returns true only when explicitly opted in', () => {
    expect(isCheckoutConfirmFlow({ checkoutConfirmFlow: true })).toBe(true);
    expect(isCheckoutConfirmFlow({ checkoutConfirmFlow: false })).toBe(false);
  });
});
