const { normalizeCustomerPhone, customerPhoneVariants } = require('../phone');

describe('normalizeCustomerPhone', () => {
  test('strips + and non-digits', () => {
    expect(normalizeCustomerPhone('+43 660 3926263')).toBe('436603926263');
    expect(normalizeCustomerPhone('436603926263')).toBe('436603926263');
  });
});

describe('customerPhoneVariants', () => {
  test('includes digits-only and + prefixed forms', () => {
    expect(customerPhoneVariants('+436603926263')).toEqual(expect.arrayContaining([
      '436603926263',
      '+436603926263',
    ]));
  });
});
