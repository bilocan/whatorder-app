const { classifyMenuMatch } = require('../menuMatch');

const DONER_MENU = [
  { id: '1', name: 'Döner', price: 8.5, available: true },
  { id: '2', name: 'Döner Box', price: 9.5, available: true },
  { id: '3', name: 'Döner Teller', price: 11, available: true },
  { id: '4', name: 'Cola', price: 2.5, available: true },
];

describe('classifyMenuMatch', () => {
  test('unique when one clear winner', () => {
    const result = classifyMenuMatch('cola', DONER_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Cola');
  });

  test('ambiguous when multiple döner variants score similarly', () => {
    const result = classifyMenuMatch('döner', DONER_MENU);
    expect(result.type).toBe('ambiguous');
    expect(result.items.length).toBeGreaterThan(1);
    expect(result.items.every(i => i.name.toLowerCase().includes('döner'))).toBe(true);
  });

  test('none when no match', () => {
    expect(classifyMenuMatch('sushi', DONER_MENU).type).toBe('none');
  });
});
