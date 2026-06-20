const { parseIntent, looksLikeOrderText, extractPartySize } = require('../intentParser');

describe('parseIntent', () => {
  test('pizza and cola for 2', () => {
    const r = parseIntent('pizza and cola for 2');
    expect(r.partySize).toBe(2);
    expect(r.items.map(i => i.name)).toEqual(expect.arrayContaining(['pizza', 'cola']));
    expect(r.parsedBy).toBe('rules');
  });

  test('2x döner und cola', () => {
    const r = parseIntent('2x döner und cola');
    const döner = r.items.find(i => /döner/i.test(i.name));
    const cola = r.items.find(i => /cola/i.test(i.name));
    expect(döner?.qty).toBe(2);
    expect(cola?.qty).toBe(1);
  });

  test('bir pizza iki kola', () => {
    const r = parseIntent('bir pizza iki kola');
    expect(r.items).toEqual([
      { name: 'pizza', qty: 1 },
      { name: 'kola', qty: 2 },
    ]);
  });

  test('single item without qty prefix', () => {
    const r = parseIntent('döner');
    expect(r.items).toEqual([{ name: 'döner', qty: 1 }]);
  });

  test('space-separated qty items: 2 Döner 1 ayran', () => {
    const r = parseIntent('2 Döner 1 ayran');
    expect(r.items).toEqual([
      { name: 'Döner', qty: 2 },
      { name: 'ayran', qty: 1 },
    ]);
  });

  test('was empfehlt ihr still parses but matching happens downstream', () => {
    const r = parseIntent('was empfehlt ihr');
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe('extractPartySize', () => {
  test('German für 2', () => {
    expect(extractPartySize('pizza für 2 personen')).toBe(2);
  });

  test('Turkish kişi', () => {
    expect(extractPartySize('2 kişi için pizza')).toBe(2);
  });
});

describe('looksLikeOrderText', () => {
  test('rejects greetings', () => {
    expect(looksLikeOrderText('Merhaba', 'merhaba')).toBe(false);
    expect(looksLikeOrderText('Hello', 'hello')).toBe(false);
  });

  test('accepts order-like text', () => {
    expect(looksLikeOrderText('2x döner + cola', '2x döner + cola')).toBe(true);
    expect(looksLikeOrderText('döner', 'döner')).toBe(true);
  });
});
