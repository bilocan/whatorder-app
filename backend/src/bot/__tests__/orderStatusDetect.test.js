const { detectOrderStatusQuestion } = require('../orderStatusDetect');

describe('detectOrderStatusQuestion', () => {
  test('detects German status questions', () => {
    expect(detectOrderStatusQuestion('wo bleibt meine bestellung')).toBe(true);
    expect(detectOrderStatusQuestion('Wann kommt mein Essen?')).toBe(true);
  });

  test('detects English status questions', () => {
    expect(detectOrderStatusQuestion('where is my order')).toBe(true);
    expect(detectOrderStatusQuestion('order status please')).toBe(true);
  });

  test('detects Turkish status questions', () => {
    expect(detectOrderStatusQuestion('siparisim nerede')).toBe(true);
  });

  test('does not match order phrases', () => {
    expect(detectOrderStatusQuestion('2 döner 1 ayran')).toBe(false);
    expect(detectOrderStatusQuestion('')).toBe(false);
  });
});
