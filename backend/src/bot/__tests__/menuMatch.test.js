const { classifyMenuMatch } = require('../menuMatch');
const { suggestItemAliases } = require('../menuItemAliases');

const DONER_MENU = [
  { id: '1', name: 'Döner', price: 8.5, available: true },
  { id: '2', name: 'Döner Box', price: 9.5, available: true },
  { id: '3', name: 'Döner Teller', price: 11, available: true },
  { id: '4', name: 'Cola', price: 2.5, available: true },
];

const SANDWICH_MENU = [
  ...DONER_MENU,
  { id: '5', name: 'Döner Sandwich', price: 7.5, available: true },
  { id: '6', name: 'Kebap Sandwich Huhn', price: 7.5, available: true },
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

  test('unique for Döner Sandwich mit allem when sandwich item exists', () => {
    const result = classifyMenuMatch('Döner Sandwich mit allem', SANDWICH_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Döner Sandwich');
  });

  test('does not treat Döner Sandwich as generic döner', () => {
    const result = classifyMenuMatch('2x Döner Sandwich mit allem', SANDWICH_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('5');
  });

  test('matches Hühner kebap Sandwich to Kebap Sandwich Huhn', () => {
    const result = classifyMenuMatch('Hühner kebap Sandwich mit allem', SANDWICH_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Kebap Sandwich Huhn');
  });

  test('matches glued hühnerkebab compound to Kebap Sandwich Huhn', () => {
    const result = classifyMenuMatch('hühnerkebab mit allem', SANDWICH_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Kebap Sandwich Huhn');
  });

  test('full German order with glued hühnerkebab splits modifiers', () => {
    const { parseIntent } = require('../intentParser');
    const { matchIntentToMenu } = require('../intentMatcher');
    const text = 'Ich hätte gerne zwei hühnerkebab eine mit allen eine ohne Sauce und Zwiebel';
    const intent = parseIntent(text);
    const { matched, unmatched } = matchIntentToMenu(intent, SANDWICH_MENU);
    expect(matched).toHaveLength(2);
    expect(matched.every(m => m.name === 'Kebap Sandwich Huhn')).toBe(true);
    expect(unmatched).toEqual([]);
  });

  test('matches full German takeaway order blob', () => {
    const text = 'Zum Mitnehmen zwei Hühner kebap Sandwich mit allem einer ohne zwiebel';
    const result = classifyMenuMatch(text, SANDWICH_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('6');
  });
});

const PIZZA_MENU = [
  { id: 'p1', name: 'Pizza Margherita', price: 10, available: true },
  { id: 'p2', name: 'Pizza Spinaci', price: 11, available: true },
  { id: 'p3', name: 'Pizza Salami', price: 11, available: true },
  { id: 'fp1', name: 'Familienpizza Margherita', price: 18, available: true },
];

describe('classifyMenuMatch — Austrian pizza', () => {
  test('Margarita typo matches standard Margherita not Familienpizza', () => {
    const result = classifyMenuMatch('Pizza Margarita', PIZZA_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('p1');
  });

  test('spinati matches Pizza Spinaci', () => {
    const result = classifyMenuMatch('spinati', PIZZA_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Pizza Spinaci');
  });

  test('Familienpizza request matches large size', () => {
    const result = classifyMenuMatch('Familienpizza Margherita', PIZZA_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('fp1');
  });

  test('Familienpizza alone lists category submenu', () => {
    const menu = [
      { id: 'f1', name: 'Margherita', price: 18, category: 'Familienpizza', available: true },
      { id: 'f2', name: 'Salami', price: 19, category: 'Familienpizza', available: true },
      { id: 'p1', name: 'Margherita', price: 10, category: 'Pizza', available: true },
    ];
    const result = classifyMenuMatch('Familienpizza', menu);
    expect(result.type).toBe('ambiguous');
    expect(result.items).toHaveLength(2);
    expect(result.items.every(i => i.category === 'Familienpizza')).toBe(true);
  });

  test('Eine Pizza Margarita und eine spinati — both unique', () => {
    const { parseIntent } = require('../intentParser');
    const { matchIntentToMenu } = require('../intentMatcher');
    const intent = parseIntent('Eine Pizza Margarita und eine spinati');
    const { matched, disambiguation } = matchIntentToMenu(intent, PIZZA_MENU);
    expect(disambiguation).toBeNull();
    expect(matched).toHaveLength(2);
    expect(matched.map(m => m.name)).toEqual(['Pizza Margherita', 'Pizza Spinaci']);
  });

  test('Margarete typo and ayram match margherita and ayran', () => {
    const { parseIntent } = require('../intentParser');
    const { matchIntentToMenu } = require('../intentMatcher');
    const menu = [...PIZZA_MENU, { id: 'a1', name: 'Ayran', price: 2.5, available: true }];
    const intent = parseIntent('Eine Margarete und eine spinati und jeweils einer bitte ayram bitte');
    const { matched, disambiguation, unmatched } = matchIntentToMenu(intent, menu);
    expect(disambiguation).toBeNull();
    expect(unmatched).toEqual([]);
    expect(matched.map(m => ({ name: m.name, qty: m.qty }))).toEqual([
      { name: 'Pizza Margherita', qty: 1 },
      { name: 'Pizza Spinaci', qty: 1 },
      { name: 'Ayran', qty: 2 },
    ]);
  });
});

const ENES_PIZZA_MENU = [
  { id: 'm1', name: 'Pizza Marinara (33cm)', price: 9.9, available: true },
  { id: 'm2', name: 'Pizza Margherita (33cm)', price: 12.9, available: true },
  { id: 'm3', name: 'Pizza Spinachi (33cm)', price: 13.9, available: true },
  { id: 'm4', name: 'Pizza Tonno (33cm)', price: 14.9, available: true },
];

const BURGER_MENU = [
  { id: 'b1', name: 'Cheeseburger XXXL mit Pommes', price: 12.9, available: true },
  { id: 'b2', name: 'Hamburger XXXL', price: 10.9, available: true },
];

const EISTEE_MENU = [
  { id: 'e1', name: 'Eistee Pfirsich 0.33L', price: 2.9, available: true },
  { id: 'e2', name: 'Eistee Pfirsich 0.5L', price: 3.5, available: true },
  { id: 'e3', name: 'Eistee Zitrone 0.33L', price: 2.9, available: true },
];

describe('classifyMenuMatch — ice tea synonyms', () => {
  test('icetea and ice tea stay ambiguous without owner stemDefaults', () => {
    for (const phrase of ['icetea', 'ice tea']) {
      const result = classifyMenuMatch(phrase, EISTEE_MENU);
      expect(result.type).toBe('ambiguous');
    }
  });

  test('icetea resolves via owner stemDefaults', () => {
    const menuMatch = {
      defaults: { stemDefaults: { icetea: 'e1', 'ice tea': 'e1', eistee: 'e1' } },
    };
    expect(classifyMenuMatch('icetea', EISTEE_MENU, menuMatch).item.name).toBe('Eistee Pfirsich 0.33L');
  });

  test('peach ice tea resolves via item aliases', () => {
    const menu = [{
      id: 'e1',
      name: 'Eistee Pfirsich 0.33L',
      price: 2.9,
      available: true,
      aliases: suggestItemAliases('Eistee Pfirsich 0.33L'),
    }];
    const result = classifyMenuMatch('peach ice tea', menu);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('e1');
  });
});

describe('classifyMenuMatch — burger TTS typos', () => {
  test('chisburger matches Cheeseburger not Hamburger', () => {
    const result = classifyMenuMatch('chisburger', BURGER_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Cheeseburger XXXL mit Pommes');
  });
});

describe('classifyMenuMatch — Enes spinaci / spinachi typos', () => {
  test('spinaci matches Pizza Spinachi (33cm)', () => {
    const result = classifyMenuMatch('spinaci', ENES_PIZZA_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Pizza Spinachi (33cm)');
  });

  test('eine spinaci noch bitte matches Spinachi not Marinara', () => {
    const { parseIntent } = require('../intentParser');
    const { matchIntentToMenu } = require('../intentMatcher');
    const { normalizeIntentItemName } = require('../intentModifiers');
    const intent = parseIntent('eine spinaci noch bitte');
    const name = normalizeIntentItemName(intent.items[0].name);
    const result = classifyMenuMatch(name, ENES_PIZZA_MENU);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('m3');
    const { matched, unmatched } = matchIntentToMenu(intent, ENES_PIZZA_MENU);
    expect(unmatched).toEqual([]);
    expect(matched[0].name).toBe('Pizza Spinachi (33cm)');
  });

  test('eine spinaci pizza bitte matches Spinachi not cheapest Marinara', () => {
    const { parseIntent } = require('../intentParser');
    const { matchIntentToMenu } = require('../intentMatcher');
    const intent = parseIntent('eine spinaci pizza bitte');
    const { matched, unmatched } = matchIntentToMenu(intent, ENES_PIZZA_MENU);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('Pizza Spinachi (33cm)');
  });

  test('pizza thunfisch matches Pizza Tonno (33cm) not generic pizza list', () => {
    const { parseIntent } = require('../intentParser');
    const { matchIntentToMenu } = require('../intentMatcher');
    const intent = parseIntent('pizza thunfisch');
    const { matched, disambiguation, unmatched } = matchIntentToMenu(intent, ENES_PIZZA_MENU);
    expect(disambiguation).toBeNull();
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe('Pizza Tonno (33cm)');
  });

  test('schnitzel teller mit pommes matches Schnitzel Teller not Pommes SKUs', () => {
    const menu = [
      { id: 'pommes', name: 'Pommes Frites', price: 3.5, available: true },
      { id: 'burger', name: 'Cheeseburger XXXL mit Pommes', price: 9.9, available: true },
      { id: 'teller', name: 'Schnitzel Teller', price: 13.9, available: true, category: 'Schnitzel' },
    ];
    const result = classifyMenuMatch('schnitzel teller mit pommes', menu);
    expect(result.type).toBe('unique');
    expect(result.item.name).toBe('Schnitzel Teller');
  });
});

const ENES_SPINATI_MENU = [
  { id: 'pide', name: 'Pide Spinat', price: 10.9, available: true, category: 'Pide' },
  {
    id: 'p33',
    name: 'Pizza Spinachi (33cm)',
    price: 13.9,
    available: true,
    category: 'Pizza 33cm',
    aliases: ['pizza spinaci', 'pizza spinati'],
  },
  {
    id: 'p50',
    name: 'Pizza Spinachi (Familien-Pizza 50cm)',
    price: 18.5,
    available: true,
    category: 'Familien-Pizza 50cm',
    aliases: ['pizza spinati familien pizza'],
  },
];

const ENES_MENU_MATCH = {
  version: 1,
  defaults: { pizzaCategory: 'Pizza 33cm' },
  categories: {},
};

describe('classifyMenuMatch — owner default pizza category', () => {
  test('bare spinati drops familien size when owner default is Pizza 33cm', () => {
    const result = classifyMenuMatch('spinati', ENES_SPINATI_MENU, ENES_MENU_MATCH);
    expect(result.type).toBe('ambiguous');
    expect(result.items.map(i => i.id).sort()).toEqual(['p33', 'pide']);
  });

  test('owner can point default at familien category', () => {
    const famDefault = { defaults: { pizzaCategory: 'Familien-Pizza 50cm' }, categories: {} };
    const result = classifyMenuMatch('spinati', ENES_SPINATI_MENU, famDefault);
    expect(result.type).toBe('ambiguous');
    expect(result.items.map(i => i.id).sort()).toEqual(['p50', 'pide']);
  });

  test('Familienpizza in phrase still selects familien SKUs', () => {
    const menu = [
      { id: 'p33', name: 'Pizza Margherita (33cm)', price: 12.9, available: true, category: 'Pizza 33cm' },
      { id: 'p50', name: 'Pizza Margherita (Familien-Pizza 50cm)', price: 18, available: true, category: 'Familien-Pizza 50cm' },
    ];
    const result = classifyMenuMatch('Familienpizza Margherita', menu, ENES_MENU_MATCH);
    expect(result.type).toBe('unique');
    expect(result.item.id).toBe('p50');
  });
});
