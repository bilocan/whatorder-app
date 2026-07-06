const { basketSubtotal, orderTotals } = require('../../bot/orderTotals');

describe('checkout orderTotals', () => {
  const basket = [
    { name: 'Döner', qty: 2, price: 8.5 },
    { name: 'Cola', qty: 1, price: 2.5 },
  ];

  test('basketSubtotal sums line totals', () => {
    expect(basketSubtotal(basket)).toBe(19.5);
  });

  test('pickup order has no delivery fee', () => {
    const totals = orderTotals(basket, { orderType: 'pickup' }, { deliveryFee: 3 });
    expect(totals).toEqual({
      subtotal: 19.5,
      deliveryFee: 0,
      total: 19.5,
      isDelivery: false,
    });
  });

  test('delivery order adds delivery fee to total', () => {
    const totals = orderTotals(basket, { orderType: 'delivery' }, { deliveryFee: 3 });
    expect(totals).toEqual({
      subtotal: 19.5,
      deliveryFee: 3,
      total: 22.5,
      isDelivery: true,
    });
  });
});
