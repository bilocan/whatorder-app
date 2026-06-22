const { resolvePhase, actionsForPhase, buildKeypadContext } = require('../keypadActions');

describe('keypadActions', () => {
  test('empty basket → menu + reorder actions', () => {
    const ctx = buildKeypadContext({ state: 'browsing', basket: [] }, 'en');
    expect(ctx.phase).toBe('empty');
    expect(ctx.actions.map((a) => a.id)).toEqual(['menu', 'reorder']);
  });

  test('basket with items → checkout, menu, clear', () => {
    const ctx = buildKeypadContext({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
    }, 'en');
    expect(ctx.phase).toBe('has_basket');
    expect(ctx.basketCount).toBe(1);
    expect(ctx.basket[0].name).toBe('Döner');
    expect(ctx.actions.map((a) => a.id)).toEqual(['checkout', 'menu', 'clear']);
  });

  test('confirming state → place order + cancel', () => {
    const ctx = buildKeypadContext({ state: 'confirming', basket: [{ name: 'A', qty: 1, price: 5 }] }, 'de');
    expect(ctx.phase).toBe('confirming');
    expect(ctx.actions[0].text).toBe('yes');
  });

  test('resolvePhase for proposal', () => {
    expect(resolvePhase({ pendingIntentItems: [{ name: 'X' }] })).toBe('proposal');
  });
});
