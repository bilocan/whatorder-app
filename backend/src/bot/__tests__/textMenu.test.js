const {
  looksLikeNumberSelection,
  parseNumberSelection,
  buildNumberedMenuChunks,
} = require('../textMenu');

const index = [
  { id: 'a', name: 'Margherita', price: 8.5 },
  { id: 'b', name: 'Pepperoni', price: 9.0 },
  { id: 'c', name: 'Funghi', price: 9.5 },
];

describe('looksLikeNumberSelection', () => {
  test('accepts comma-separated numbers', () => {
    expect(looksLikeNumberSelection('1, 3', index)).toBe(true);
  });

  test('rejects text with letters', () => {
    expect(looksLikeNumberSelection('2x döner', index)).toBe(false);
  });

  test('rejects when no text menu index', () => {
    expect(looksLikeNumberSelection('1, 2', null)).toBe(false);
  });
});

describe('parseNumberSelection', () => {
  test('parses comma-separated item numbers', () => {
    const { matched, invalid } = parseNumberSelection('1, 3', index);
    expect(invalid).toEqual([]);
    expect(matched).toEqual([
      { menuItemId: 'a', name: 'Margherita', qty: 1, price: 8.5 },
      { menuItemId: 'c', name: 'Funghi', qty: 1, price: 9.5 },
    ]);
  });

  test('parses quantity prefix 2x2', () => {
    const { matched } = parseNumberSelection('2x2', index);
    expect(matched).toEqual([
      { menuItemId: 'b', name: 'Pepperoni', qty: 2, price: 9.0 },
    ]);
  });

  test('returns invalid tokens for out-of-range numbers', () => {
    const { matched, invalid } = parseNumberSelection('99', index);
    expect(matched).toEqual([]);
    expect(invalid).toEqual(['99']);
  });
});

describe('buildNumberedMenuChunks', () => {
  test('numbers items from 1 and includes selection hint', () => {
    const { messages, indexed } = buildNumberedMenuChunks(index, 'en', 'Pizza');
    expect(indexed).toHaveLength(3);
    expect(messages[0]).toContain('1. Margherita');
    expect(messages[0]).toContain('Reply with item numbers');
  });
});
