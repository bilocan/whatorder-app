const { parseIntent, looksLikeOrderText, extractPartySize, applyJeweilsBasketContext } = require('../intentParser');

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

  test('German zwei with einer ohne zwiebel splits into two lines', () => {
    const r = parseIntent('zum mitnehmen zwei döner mit allem einer ohne zwiebel');
    expect(r.items).toEqual([
      { name: 'döner mit allem', qty: 1 },
      { name: 'döner ohne zwiebel', qty: 1 },
    ]);
  });

  test('German zwei Hühner kebap Sandwich takeaway order', () => {
    const r = parseIntent('Zum Mitnehmen zwei Hühner kebap Sandwich mit allem einer ohne zwiebel');
    expect(r.items).toEqual([
      { name: 'Hühner kebap Sandwich mit allem', qty: 1 },
      { name: 'Hühner kebap Sandwich ohne zwiebel', qty: 1 },
    ]);
  });

  test('German zwei kebab eine mit allem und andere ohne (polite prefix)', () => {
    const r = parseIntent(
      'ich hätte gerne zwei Hühner Kebab eine mit allem und andere ohne Schaf und Soße bitte',
    );
    expect(r.items).toEqual([
      { name: 'Hühner Kebab mit allem', qty: 1 },
      { name: 'Hühner Kebab ohne Schaf und Soße', qty: 1 },
    ]);
  });

  test('German zwei döner einer mit allem einer ohne zwiebeln', () => {
    const r = parseIntent('zum mitnehmen zwei döner einer mit allem einer ohne zwiebeln');
    expect(r.items).toEqual([
      { name: 'döner mit allem', qty: 1 },
      { name: 'döner ohne zwiebeln', qty: 1 },
    ]);
  });

  test('German eine X und eine Y splits into two pizzas', () => {
    const r = parseIntent('Eine Pizza Margarita und eine spinati');
    expect(r.items).toEqual([
      { name: 'Pizza Margarita', qty: 1 },
      { name: 'spinati', qty: 1 },
    ]);
  });

  test('jeweils einer drink adds one per food item', () => {
    const r = parseIntent('Eine Margarete und eine spinati und jeweils einer bitte ayram bitte');
    expect(r.items).toEqual([
      { name: 'Margarete', qty: 1 },
      { name: 'spinati', qty: 1 },
      { name: 'ayram', qty: 2 },
    ]);
  });

  test('jeweils drink uses food qty not line count', () => {
    const r = parseIntent('zwei Hühner Kebab und jeweils einer ayran bitte');
    expect(r.items).toEqual([
      { name: 'Hühner Kebab', qty: 2 },
      { name: 'ayran', qty: 2 },
    ]);
  });

  test('standalone jeweils ayran parses drink only', () => {
    const r = parseIntent('jeweils ayran noch bitte');
    expect(r.items).toEqual([{ name: 'ayran', qty: 1 }]);
  });

  test('applyJeweilsBasketContext scales drink to basket meals', () => {
    const intent = parseIntent('jeweils ayran noch bitte');
    const basket = [
      { name: 'Kebap Sandwich Huhn — Sauce', qty: 3, price: 7.5 },
    ];
    const scaled = applyJeweilsBasketContext(intent, basket);
    expect(scaled.items).toEqual([{ name: 'ayran', qty: 3 }]);
  });

  test('applyJeweilsBasketContext ignores drinks already in basket', () => {
    const intent = parseIntent('jeweils ayran noch bitte');
    const basket = [
      { name: 'Kebap Sandwich Huhn', qty: 2, price: 7.5 },
      { name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 },
    ];
    const scaled = applyJeweilsBasketContext(intent, basket);
    expect(scaled.items).toEqual([{ name: 'ayran', qty: 2 }]);
  });

  test('zwei kebab ein cola splits food and embedded drink', () => {
    const r = parseIntent('Zwei Hühner Kebab ein Cola und ein ayran bitte');
    expect(r.items).toEqual([
      { name: 'Hühner Kebab', qty: 2 },
      { name: 'Cola', qty: 1 },
      { name: 'ayran', qty: 1 },
    ]);
  });

  test('zwei kebab einen döner splits two food lines and drops noise', () => {
    const r = parseIntent('Zwei Hühner Kebab einen Döner und an einem bitte');
    expect(r.items).toEqual([
      { name: 'Hühner Kebab', qty: 2 },
      { name: 'Döner', qty: 1 },
    ]);
  });

  test('TTS eier typo in drink slot', () => {
    const r = parseIntent('Zwei Hühner Kebab ein Cola und ein Eier bitte');
    expect(r.items).toEqual([
      { name: 'Hühner Kebab', qty: 2 },
      { name: 'Cola', qty: 1 },
      { name: 'Eier', qty: 1 },
    ]);
  });

  test('noch ein kebap mit allem und scharf keeps scharf on same line', () => {
    const r = parseIntent('noch ein kebap mit allem und scharf bitte');
    expect(r.items).toEqual([{ name: 'kebap mit allem und scharf', qty: 1 }]);
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
    expect(looksLikeOrderText('jeweils ayran noch bitte', 'jeweils ayran noch bitte')).toBe(true);
  });
});
