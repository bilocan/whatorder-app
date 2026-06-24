const {
  parseBasketRemove,
  parseBasketRemoveDisambig,
  applyBasketRemove,
  removeBasketByFragment,
  removeBasketAtIndices,
} = require('../basketEdit');

const BASKET = [
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
  { name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 },
  { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
];

const DUP_KEBAP_BASKET = [
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.5 },
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
  { name: 'Coca Cola 0.33L', qty: 1, price: 2.9 },
];

describe('parseBasketRemove', () => {
  test('parses line numbers', () => {
    expect(parseBasketRemove('1', '1')).toEqual({ type: 'by_index', indices: [1] });
    expect(parseBasketRemove('1, 3', '1, 3')).toEqual({ type: 'by_index', indices: [1, 3] });
    expect(parseBasketRemove('1 und 3', '1 und 3')).toEqual({ type: 'by_index', indices: [1, 3] });
  });

  test('parses remove verbs', () => {
    expect(parseBasketRemove('ohne ayran', 'ohne ayran')).toEqual({ type: 'by_name', fragment: 'ayran' });
    expect(parseBasketRemove('remove döner', 'remove döner')).toEqual({ type: 'by_name', fragment: 'döner' });
    expect(parseBasketRemove('cola cikar', 'cola cikar')).toEqual({ type: 'by_name', fragment: 'cola' });
    expect(parseBasketRemove('cola entfernen', 'cola entfernen')).toEqual({ type: 'by_name', fragment: 'cola' });
    expect(parseBasketRemove('döner entfernen', 'döner entfernen')).toEqual({ type: 'by_name', fragment: 'döner' });
  });

  test('allows bare item name in remove mode', () => {
    expect(parseBasketRemove('cola', 'cola', { allowBareName: true })).toEqual({ type: 'by_name', fragment: 'cola' });
    expect(parseBasketRemove('cola', 'cola')).toBeNull();
  });

  test('parses cancel and clear', () => {
    expect(parseBasketRemove('abbrechen', 'abbrechen')).toEqual({ type: 'cancel' });
    expect(parseBasketRemove('alles löschen', 'alles löschen')).toEqual({ type: 'clear' });
    expect(parseBasketRemove('alles', 'alles')).toEqual({ type: 'clear' });
    expect(parseBasketRemove('alle', 'alle')).toEqual({ type: 'clear' });
  });
});

describe('applyBasketRemove', () => {
  test('removes lines by index', () => {
    const result = applyBasketRemove(BASKET, { type: 'by_index', indices: [1, 3] });
    expect(result.basket).toEqual([BASKET[1]]);
  });

  test('removes lines by name fragment', () => {
    const result = applyBasketRemove(BASKET, { type: 'by_name', fragment: 'ayran' });
    expect(result.basket.map(i => i.name)).toEqual([
      'Kebap Sandwich Huhn — Tomaten, Salad',
      'Coca Cola 0.33L',
    ]);
  });

  test('removes multiple names from one message', () => {
    const next = removeBasketByFragment(BASKET, 'kebap und ayran');
    expect(next.map(i => i.name)).toEqual(['Coca Cola 0.33L']);
  });

  test('returns ambiguous when multiple lines match name', () => {
    const result = applyBasketRemove(DUP_KEBAP_BASKET, { type: 'by_name', fragment: 'kebap' });
    expect(result).toEqual({
      type: 'ambiguous',
      indices: [1, 2],
      fragment: 'kebap',
    });
  });

  test('removes single matching line without asking', () => {
    const result = applyBasketRemove(DUP_KEBAP_BASKET, { type: 'by_name', fragment: 'cola' });
    expect(result.basket).toHaveLength(2);
  });
});

describe('parseBasketRemoveDisambig', () => {
  const disambigTwo = { fragment: 'kebap', indices: [1, 2] };
  const disambigThree = { fragment: 'kebap', indices: [1, 2, 3] };

  test('alle removes all choices', () => {
    expect(parseBasketRemoveDisambig('alle', 'alle', disambigTwo)).toEqual({
      type: 'by_index', indices: [1, 2],
    });
  });

  test('beide removes both only when exactly two choices', () => {
    expect(parseBasketRemoveDisambig('beide', 'beide', disambigTwo)).toEqual({
      type: 'by_index', indices: [1, 2],
    });
    expect(parseBasketRemoveDisambig('beide', 'beide', disambigThree)).toBeNull();
  });

  test('both removes both only when exactly two choices', () => {
    expect(parseBasketRemoveDisambig('both', 'both', disambigTwo)).toEqual({
      type: 'by_index', indices: [1, 2],
    });
    expect(parseBasketRemoveDisambig('both', 'both', disambigThree)).toBeNull();
  });

  test('picks a single line number from choices', () => {
    expect(parseBasketRemoveDisambig('2', '2', disambigTwo)).toEqual({
      type: 'by_index', indices: [2],
    });
  });
});

describe('removeBasketAtIndices', () => {
  test('removes multiple one-based indices', () => {
    expect(removeBasketAtIndices(BASKET, [1, 3])).toEqual([BASKET[1]]);
  });
});
