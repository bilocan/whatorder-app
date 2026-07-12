const { parseIntent, looksLikeOrderText, isStrongOrderText, extractPartySize, applyJeweilsBasketContext, rulesParseQuality } = require('../intentParser');

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

  test('ich esse doner mit toppings und cola strips conversational prefix', () => {
    const r = parseIntent('ich esse doner mit tomaten salad und cola');
    expect(r.items).toEqual([
      { name: 'doner mit tomaten salad', qty: 1 },
      { name: 'cola', qty: 1 },
    ]);
  });

  test('German zwei hühnerkebab eine mit allen eine ohne Sauce und Zwiebel', () => {
    const r = parseIntent(
      'Ich hätte gerne zwei hühnerkebab eine mit allen eine ohne Sauce und Zwiebel',
    );
    expect(r.items).toEqual([
      { name: 'hühnerkebab mit allem', qty: 1 },
      { name: 'hühnerkebab ohne Sauce und Zwiebel', qty: 1 },
    ]);
  });

  test('German zwei döner einer mit allem einer ohne zwiebeln', () => {
    const r = parseIntent('zum mitnehmen zwei döner einer mit allem einer ohne zwiebeln');
    expect(r.items).toEqual([
      { name: 'döner mit allem', qty: 1 },
      { name: 'döner ohne zwiebeln', qty: 1 },
    ]);
  });

  test('German hallo wir hatten gerne zwei doner beide mit allen eine extra scharf', () => {
    const r = parseIntent('hallo wir hatten gerne zwei doner beide mit allen eine extra scharf bitte');
    expect(r.items).toEqual([
      { name: 'doner mit allen ohne scharf', qty: 1 },
      { name: 'doner mit allen und scharf', qty: 1 },
    ]);
  });

  test('German zwei doner beide mit alles eine extra scharf recovers from leading-qty collapse', () => {
    const r = parseIntent('zwei doner beide mit alles eine extra scharf bitte');
    expect(r.items).toEqual([
      { name: 'doner mit allen ohne scharf', qty: 1 },
      { name: 'doner mit allen und scharf', qty: 1 },
    ]);
  });

  test('trailing quote after bitte does not collapse beide mit allen split', () => {
    const r = parseIntent('hallo wir hatten gerne zwei doner beide mit allen eine extra scharf bitte"');
    expect(r.items).toEqual([
      { name: 'doner mit allen ohne scharf', qty: 1 },
      { name: 'doner mit allen und scharf', qty: 1 },
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

  test('noch 3 cola preserves quantity after continuation prefix', () => {
    const r = parseIntent('noch 3 cola');
    expect(r.items).toEqual([{ name: 'cola', qty: 3 }]);
  });

  test('1 kola daha strips TR daha suffix before parse', () => {
    const r = parseIntent('1 kola daha');
    expect(r.items).toEqual([{ name: 'kola', qty: 1 }]);
  });

  test('1 kola raus keeps qty for partial remove (no removeAll)', async () => {
    const { parseIntentAsync } = require('../intentParser');
    const r = await parseIntentAsync('1 kola raus', { phone: '+1', rulesOnly: true });
    expect(r.operation).toBe('remove');
    expect(r.items).toEqual([{ name: 'kola', qty: 1 }]);
    expect(r.items[0].removeAll).toBeUndefined();
  });

  test('cola raus suffix sets removeAll for drop-whole-line', async () => {
    const { parseIntentAsync } = require('../intentParser');
    const r = await parseIntentAsync('cola raus', { phone: '+1', rulesOnly: true });
    expect(r.items).toEqual([{ name: 'cola', qty: 1, removeAll: true }]);
  });

  test('pide mit eier und gouda stays one line (mit-ingredient und)', () => {
    const r = parseIntent('Eine pide mit Eier und gouda');
    expect(r.items).toEqual([{ name: 'pide mit Eier und gouda', qty: 1 }]);
  });

  test('sharf typo stays on kebap line not a separate item', () => {
    const r = parseIntent('bitte ein kebap mit allen und sharf und ayran dazu');
    expect(r.items).toEqual([
      { name: 'kebap mit allen und sharf', qty: 1 },
      { name: 'ayran dazu', qty: 1 },
    ]);
  });

  test('bitte ein kebap mit tomaten salad und zwiebel stays one line', () => {
    const r = parseIntent('bitte ein kebap mit tomaten salad und zwiebel');
    expect(r.items).toEqual([
      { name: 'kebap mit tomaten salad und zwiebel', qty: 1 },
    ]);
  });

  test('ich kriege schnitzel teller mit pommes und eis tee pfirsich splits food and drink', () => {
    const r = parseIntent('ich kriege ein schnitzel teller mit pommes und eis tee pfirsich');
    expect(r.items).toEqual([
      { name: 'schnitzel teller mit pommes', qty: 1 },
      { name: 'eis tee pfirsich', qty: 1 },
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

describe('isStrongOrderText', () => {
  test('detects order phrases but not names or notes', () => {
    expect(isStrongOrderText('eine cola dazu', 'eine cola dazu')).toBe(true);
    expect(isStrongOrderText('ohne ayran', 'ohne ayran')).toBe(true);
    expect(isStrongOrderText('Ahmet', 'ahmet')).toBe(false);
    expect(isStrongOrderText('No onions please', 'no onions please')).toBe(false);
  });
});

describe('looksLikeOrderText', () => {
  test('rejects greetings', () => {
    expect(looksLikeOrderText('Merhaba', 'merhaba')).toBe(false);
    expect(looksLikeOrderText('Hello', 'hello')).toBe(false);
  });

  test('rejects fresh start commands', () => {
    expect(looksLikeOrderText('start', 'start')).toBe(false);
    expect(looksLikeOrderText('Starten', 'starten')).toBe(false);
  });

  test('accepts order-like text', () => {
    expect(looksLikeOrderText('2x döner + cola', '2x döner + cola')).toBe(true);
    expect(looksLikeOrderText('döner', 'döner')).toBe(true);
    expect(looksLikeOrderText('jeweils ayran noch bitte', 'jeweils ayran noch bitte')).toBe(true);
    expect(looksLikeOrderText('Lahmacun cola', 'lahmacun cola')).toBe(true);
  });

  test('basket command keywords are not order-like', () => {
    expect(looksLikeOrderText('warenkorb', 'warenkorb')).toBe(false);
    expect(looksLikeOrderText('was hab ich', 'was hab ich')).toBe(false);
    expect(looksLikeOrderText('rückgängig', 'ruckgangig')).toBe(false);
  });
});

describe('parseFoodDrinkPair via parseIntent', () => {
  test('splits food + drink without conjunction', () => {
    const r = parseIntent('Lahmacun cola');
    expect(r.items).toEqual([
      { name: 'Lahmacun', qty: 1 },
      { name: 'cola', qty: 1 },
    ]);
    expect(rulesParseQuality('Lahmacun cola')).toBe('high');
  });

  test('does not split two food words', () => {
    const r = parseIntent('döner kebap');
    expect(r.items).toEqual([{ name: 'döner kebap', qty: 1 }]);
  });
});
