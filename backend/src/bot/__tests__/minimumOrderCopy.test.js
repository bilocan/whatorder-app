const {
  formatDeliveryMinOrderBlurb,
  buildRestaurantGreetingBody,
} = require('../minimumOrderCopy');

describe('formatDeliveryMinOrderBlurb', () => {
  test('single min', () => {
    expect(formatDeliveryMinOrderBlurb({
      deliveryEnabled: true,
      minimumOrderValue: 13,
    }, 'de')).toBe('*Lieferung* ab €13.');
  });

  test('per-PLZ mins', () => {
    const blurb = formatDeliveryMinOrderBlurb({
      deliveryEnabled: true,
      minimumOrderByDistrict: [
        { postalCodes: ['1100'], minimumOrderValue: 13 },
        { postalCodes: ['1040', '1050'], minimumOrderValue: 30 },
      ],
    }, 'de');
    expect(blurb).toBe(
      '*Lieferung ab*\n• *1100* — ab €13\n• *1040, 1050* — ab €30',
    );
  });
});

describe('buildRestaurantGreetingBody', () => {
  test('greeting plus single min and start hint', () => {
    const body = buildRestaurantGreetingBody('de', 'Pizza Favori Test', {
      deliveryEnabled: true,
      minimumOrderValue: 13,
    });
    expect(body).toBe(
      '👋 Willkommen bei Pizza Favori Test!\n\n*Lieferung* ab €13.\n\nTippen Sie unten, um zu starten.',
    );
  });

  test('greeting with per-PLZ mins', () => {
    const body = buildRestaurantGreetingBody('de', 'Pizza Favori Test', {
      deliveryEnabled: true,
      minimumOrderByDistrict: [
        { postalCodes: ['1100'], minimumOrderValue: 13 },
        { postalCodes: ['1040', '1050'], minimumOrderValue: 30 },
      ],
    });
    expect(body).toContain('*Lieferung ab*');
    expect(body).toContain('• *1100* — ab €13');
    expect(body).toContain('Tippen Sie unten, um zu starten.');
  });
});
