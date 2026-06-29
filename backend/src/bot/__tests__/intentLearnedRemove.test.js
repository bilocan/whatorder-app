const {
  previewLearnedRemove,
  removeFromProposal,
  removeFromBasket,
} = require('../intentLearnedRemove');

describe('intentLearnedRemove', () => {
  const pending = [
    { name: 'Döner', qty: 2, menuItemId: 'd1', price: 8.5 },
    { name: 'Mis Ayran 0.25L', qty: 1, menuItemId: 'a1', price: 2 },
  ];

  const basket = [
    { name: 'Mis Ayran 0.25L', qty: 1, price: 2, menuItemId: 'a1' },
    { name: 'Cola', qty: 1, price: 2.5, menuItemId: 'c1' },
  ];

  test('removeFromProposal drops matched line', () => {
    const next = removeFromProposal(pending, [{
      name: 'Mis Ayran 0.25L',
      rawName: 'ayran',
      menuItemId: 'a1',
    }]);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Döner');
  });

  test('removeFromBasket drops matched line', () => {
    const next = removeFromBasket(basket, [{
      name: 'Mis Ayran 0.25L',
      rawName: 'ayran',
      menuItemId: 'a1',
    }]);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Cola');
  });

  test('previewLearnedRemove simulates basket remove', () => {
    const intent = {
      operation: 'remove',
      parsedBy: 'learned',
      items: [{ name: 'Mis Ayran 0.25L', menuItemId: 'a1', qty: 1, rawName: 'ayran' }],
    };
    const preview = previewLearnedRemove(intent, { basket });
    expect(preview.outcome).toBe('remove');
    expect(preview.basketAfter).toHaveLength(1);
  });

  test('previewLearnedRemove partial qty leaves remainder', () => {
    const intent = {
      operation: 'remove',
      parsedBy: 'learned',
      items: [{ name: 'Mis Ayran 0.25L', menuItemId: 'a1', qty: 1 }],
    };
    const heavy = [{ name: 'Mis Ayran 0.25L', qty: 3, price: 2, menuItemId: 'a1' }];
    const preview = previewLearnedRemove(intent, { basket: heavy });
    expect(preview.basketAfter[0].qty).toBe(2);
  });
});
