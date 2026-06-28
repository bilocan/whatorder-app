const {
  countDistinctProductStems,
  isPartialBlobTrap,
  shouldRetryIntentWithLlm,
} = require('../intentPartialMatch');
const { parseIntent } = require('../intentParser');
const { matchIntentToMenu } = require('../intentMatcher');

const MENU = [
  { id: 'c1', name: 'Coca Cola 0.33L', price: 2.9, available: true, aliases: ['cola', 'kola'] },
  { id: 'd1', name: 'Döner', price: 8.5, available: true },
];

describe('intentPartialMatch', () => {
  test('countDistinctProductStems finds drink + food in mixed phrase', () => {
    expect(countDistinctProductStems('a kola un döner bitti')).toBe(2);
    expect(countDistinctProductStems('cola')).toBe(1);
    expect(countDistinctProductStems('2 döner')).toBe(1);
  });

  test('isPartialBlobTrap when cola matches but döner is in utterance', () => {
    const text = 'a kola un döner bitti';
    const intent = parseIntent(text);
    const { matched, unmatched } = matchIntentToMenu(intent, MENU);
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toMatch(/Cola/i);
    expect(unmatched).toHaveLength(0);
    expect(isPartialBlobTrap(text, intent, matched)).toBe(true);
    expect(shouldRetryIntentWithLlm(text, intent, matched, unmatched)).toBe(true);
  });

  test('shouldRetryIntentWithLlm when rules left unmatched lines', () => {
    const intent = {
      parsedBy: 'rules',
      items: [{ name: 'döner', qty: 1 }, { name: 'schnitzel', qty: 1 }],
    };
    expect(shouldRetryIntentWithLlm('x', intent, [{ name: 'Döner', qty: 1 }], ['schnitzel'])).toBe(true);
  });

  test('should not retry after llm parse', () => {
    const intent = { parsedBy: 'llm', items: [{ name: 'x', qty: 1 }] };
    expect(shouldRetryIntentWithLlm('x', intent, [], [])).toBe(false);
  });
});
