jest.mock('../sessionStore', () => ({
  patchSession: jest.fn().mockResolvedValue(undefined),
}));

const { patchSession } = require('../sessionStore');
const {
  extractCheckoutSlotsRules,
  mergeCheckoutSlots,
  applyProfilePrefill,
  getMissingCheckoutSlots,
  stripCheckoutSlotsFromOrderText,
  tryApplyCheckoutSlotsFromText,
  buildMenuFoodTokens,
} = require('../checkoutSlots');
const { buildMenuTokenIndex } = require('../menuTokenIndex');

const ENES_LIKE_MENU = [
  { id: 'schnitzel', name: 'Schnitzel Wiener Art', price: 12, available: true },
  { id: 'lahmacun', name: 'Lahmacun', price: 8, available: true },
  { id: 'doner', name: 'Döner', price: 7, available: true },
];
const ENES_MENU_TOKENS = buildMenuFoodTokens(buildMenuTokenIndex(ENES_LIKE_MENU));

describe('checkoutSlots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractCheckoutSlotsRules', () => {
    test('front-loaded delivery, address, and card payment', () => {
      const slots = extractCheckoutSlotsRules(
        'zwei Döner zum Liefern, Musterstraße 1, mit Karte',
        'zwei doner zum liefern, musterstrasse 1, mit karte',
      );
      expect(slots.orderType).toBe('delivery');
      expect(slots.deliveryAddress).toBe('Musterstraße 1');
      expect(slots.pendingPaymentMethod).toBe('stripe');
    });

    test('pickup phrase', () => {
      const slots = extractCheckoutSlotsRules('zum Abholen bitte', 'zum abholen bitte');
      expect(slots.orderType).toBe('pickup');
    });

    test('cash payment keyword', () => {
      const slots = extractCheckoutSlotsRules('bar zahlen', 'bar zahlen');
      expect(slots.pendingPaymentMethod).toBe('cash');
    });

    test('customer name phrase', () => {
      const slots = extractCheckoutSlotsRules('ich heiße Max Müller', 'ich heisse max muller');
      expect(slots.customerName).toBe('Max Müller');
    });

    test('note prefix', () => {
      const slots = extractCheckoutSlotsRules('Notiz: ohne Zwiebeln', 'notiz: ohne zwiebeln');
      expect(slots.specialRequests).toBe('ohne Zwiebeln');
    });

    test('food-only text does not invent address', () => {
      const slots = extractCheckoutSlotsRules('2 döner und cola', '2 doner und cola');
      expect(slots.deliveryAddress).toBeUndefined();
      expect(slots.orderType).toBeUndefined();
    });
  });

  describe('stripCheckoutSlotsFromOrderText', () => {
    test('front-loaded phrase leaves food-only text for intent parse', () => {
      expect(stripCheckoutSlotsFromOrderText('2 döner zum liefern, Hauptstraße 5, bar')).toBe('2 döner');
    });

    test('inline delivery phrase stripped from single segment', () => {
      expect(stripCheckoutSlotsFromOrderText('2 döner zum liefern')).toBe('2 döner');
    });

    test('checkout-only segments removed', () => {
      expect(stripCheckoutSlotsFromOrderText('Hauptstraße 5, bar')).toBe('');
    });

    test('food text unchanged when no checkout slots', () => {
      expect(stripCheckoutSlotsFromOrderText('2 döner und cola')).toBe('2 döner und cola');
    });

    test('menu item + qty shape is not stripped as address (Schnitzel 2)', () => {
      expect(stripCheckoutSlotsFromOrderText('Schnitzel 2', ENES_MENU_TOKENS)).toBe('Schnitzel 2');
    });

    test('menu item + qty shape is not stripped as address (Lahmacun 2)', () => {
      expect(stripCheckoutSlotsFromOrderText('Lahmacun 2', ENES_MENU_TOKENS)).toBe('Lahmacun 2');
    });

    test('real address still stripped with menu tokens', () => {
      expect(stripCheckoutSlotsFromOrderText('2 döner, Hauptstraße 5, bar', ENES_MENU_TOKENS)).toBe('2 döner');
    });
  });

  describe('extractCheckoutSlotsRules with menu tokens', () => {
    test('does not treat menu item + qty as delivery address', () => {
      const slots = extractCheckoutSlotsRules('Schnitzel 2, zum Liefern', 'schnitzel 2, zum liefern', ENES_MENU_TOKENS);
      expect(slots.deliveryAddress).toBeUndefined();
      expect(slots.orderType).toBe('delivery');
    });

    test('still captures standalone street address', () => {
      const slots = extractCheckoutSlotsRules('Hauptstraße 12, 1040 Wien', 'hauptstrasse 12, 1040 wien', ENES_MENU_TOKENS);
      expect(slots.deliveryAddress).toBe('Hauptstraße 12');
    });
  });

  describe('mergeCheckoutSlots', () => {
    test('does not overwrite existing session fields', () => {
      const merged = mergeCheckoutSlots(
        { orderType: 'pickup', customerName: 'Anna' },
        { orderType: 'delivery', customerName: 'Bob', pendingPaymentMethod: 'cash' },
      );
      expect(merged.orderType).toBe('pickup');
      expect(merged.customerName).toBe('Anna');
      expect(merged.pendingPaymentMethod).toBe('cash');
    });
  });

  describe('applyProfilePrefill', () => {
    test('fills name and last delivery address for returning customer', () => {
      const merged = applyProfilePrefill(
        { orderType: 'delivery' },
        { name: 'Hamza', lastDeliveryAddress: 'Hauptstraße 5' },
      );
      expect(merged.customerName).toBe('Hamza');
      expect(merged.deliveryAddress).toBe('Hauptstraße 5');
    });
  });

  describe('getMissingCheckoutSlots', () => {
    const info = { deliveryEnabled: true };

    test('all filled after extraction + profile', () => {
      const missing = getMissingCheckoutSlots({
        orderType: 'delivery',
        deliveryAddress: 'Musterstraße 1',
        customerName: 'Max',
      }, info);
      expect(missing).toEqual([]);
    });

    test('missing order type when delivery offered', () => {
      expect(getMissingCheckoutSlots({ customerName: 'Max' }, info)).toContain('orderType');
    });

    test('missing address for delivery', () => {
      const missing = getMissingCheckoutSlots({ orderType: 'delivery', customerName: 'Max' }, info);
      expect(missing).toContain('deliveryAddress');
    });
  });

  describe('tryApplyCheckoutSlotsFromText', () => {
    test('persists slots when flag on', async () => {
      const session = { state: 'browsing', basket: [] };
      const next = await tryApplyCheckoutSlotsFromText({
        from: '+431',
        session,
        text: 'zum Liefern, Hauptstraße 12',
        norm: 'zum liefern, hauptstrasse 12',
        business: { conversationalBasket: true },
      });
      expect(patchSession).toHaveBeenCalledWith('+431', {
        orderType: 'delivery',
        deliveryAddress: 'Hauptstraße 12',
      }, session);
      expect(next.orderType).toBe('delivery');
      expect(next.deliveryAddress).toBe('Hauptstraße 12');
    });

    test('no-op when flag off', async () => {
      const session = { state: 'browsing' };
      const next = await tryApplyCheckoutSlotsFromText({
        from: '+431',
        session,
        text: 'zum Liefern',
        norm: 'zum liefern',
        business: { conversationalBasket: false },
      });
      expect(patchSession).not.toHaveBeenCalled();
      expect(next).toBe(session);
    });
  });
});
