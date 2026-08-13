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
      discount: 0,
      total: 19.5,
      isDelivery: false,
      deal: null,
    });
  });

  test('delivery order adds delivery fee to total', () => {
    const totals = orderTotals(basket, { orderType: 'delivery' }, { deliveryFee: 3 });
    expect(totals).toEqual({
      subtotal: 19.5,
      deliveryFee: 3,
      discount: 0,
      total: 22.5,
      isDelivery: true,
      deal: null,
    });
  });

  test('deal reduces subtotal only; delivery fee unchanged', () => {
    const deal = { discount: 2, label: '€2 Lunch', kind: 'window' };
    const totals = orderTotals(basket, { orderType: 'delivery' }, { deliveryFee: 3 }, deal);
    expect(totals.subtotal).toBe(19.5);
    expect(totals.discount).toBe(2);
    expect(totals.deliveryFee).toBe(3);
    expect(totals.total).toBe(20.5);
    expect(totals.deal).toBe(deal);
  });

  test('discount cannot exceed subtotal', () => {
    const totals = orderTotals(basket, { orderType: 'pickup' }, {}, { discount: 100 });
    expect(totals.discount).toBe(19.5);
    expect(totals.total).toBe(0);
  });
});
