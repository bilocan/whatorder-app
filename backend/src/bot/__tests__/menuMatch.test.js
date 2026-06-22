const { classifyMenuMatch } = require('../menuMatch');

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
