const {
  parsePaymentKeyword,
  parseOrderTypeKeyword,
  isBareCheckoutDigit,
} = require('../checkoutOps');

describe('checkoutOps keywords', () => {
  test('parsePaymentKeyword', () => {
    expect(parsePaymentKeyword('karte')).toBe('card');
    expect(parsePaymentKeyword('bar')).toBe('cash');
    expect(parsePaymentKeyword('nakit')).toBe('cash');
    expect(parsePaymentKeyword('hamza')).toBe(null);
  });

  test('parseOrderTypeKeyword', () => {
    expect(parseOrderTypeKeyword('abholen')).toBe('pickup');
    expect(parseOrderTypeKeyword('lieferung')).toBe('delivery');
    expect(parseOrderTypeKeyword('paket')).toBe('delivery');
    expect(parseOrderTypeKeyword('max')).toBe(null);
  });

  test('isBareCheckoutDigit', () => {
    expect(isBareCheckoutDigit('1', 'confirming')).toBe(true);
    expect(isBareCheckoutDigit('1', 'awaiting_delivery_address')).toBe(false);
    expect(isBareCheckoutDigit('musterstraße 1', 'awaiting_name')).toBe(false);
  });
});
