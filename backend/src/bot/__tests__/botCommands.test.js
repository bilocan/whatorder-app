jest.mock('../../lib/llm', () => ({
  canCallLlm: jest.fn(),
  parseBotCommandWithLlm: jest.fn(),
}));
jest.mock('../../lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        increment: jest.fn(n => ({ __increment: n })),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true })),
      },
    },
  },
}));
jest.mock('../../lib/collections', () => ({
  commandLearningRef: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({ exists: false }),
    set: jest.fn().mockResolvedValue(undefined),
  })),
}));

const { canCallLlm, parseBotCommandWithLlm } = require('../../lib/llm');
const {
  detectBotCommandRules,
  detectBotCommandAsync,
  isBotCommandPhrase,
  isBasketUndoPhrase,
  BOT_COMMAND,
} = require('../botCommands');
const { rememberLearnedCommand, _resetCommandCache } = require('../commandLearning');

describe('botCommands', () => {
  beforeEach(() => {
    _resetCommandCache();
    canCallLlm.mockReturnValue(false);
    parseBotCommandWithLlm.mockResolvedValue(null);
  });

  describe('detectBotCommandRules', () => {
    test('view basket keywords', () => {
      expect(detectBotCommandRules('warenkorb')?.command).toBe(BOT_COMMAND.VIEW_BASKET);
      expect(detectBotCommandRules('basket')?.command).toBe(BOT_COMMAND.VIEW_BASKET);
      expect(detectBotCommandRules('was hab ich')?.command).toBe(BOT_COMMAND.VIEW_BASKET);
      expect(detectBotCommandRules('zeig mir den warenkorb')?.command).toBe(BOT_COMMAND.VIEW_BASKET);
    });

    test('undo keywords', () => {
      expect(detectBotCommandRules('rückgängig')?.command).toBe(BOT_COMMAND.UNDO);
      expect(detectBotCommandRules('undo')?.command).toBe(BOT_COMMAND.UNDO);
      expect(detectBotCommandRules('geri al')?.command).toBe(BOT_COMMAND.UNDO);
    });

    test('zurück only when undo snapshot exists', () => {
      expect(detectBotCommandRules('zurück')?.command).toBeUndefined();
      expect(detectBotCommandRules('zurück', { hasUndoSnapshot: true })?.command).toBe(BOT_COMMAND.UNDO);
    });

    test('food text is not a command', () => {
      expect(detectBotCommandRules('2x döner')).toBeNull();
      expect(detectBotCommandRules('döner')).toBeNull();
    });
  });

  describe('isBotCommandPhrase', () => {
    test('excludes basket commands from order-like guard', () => {
      expect(isBotCommandPhrase('warenkorb', 'warenkorb')).toBe(true);
      expect(isBotCommandPhrase('rückgängig', 'ruckgangig')).toBe(true);
      expect(isBotCommandPhrase('döner', 'doner')).toBe(false);
    });
  });

  describe('isBasketUndoPhrase', () => {
    test('matches normalized undo phrases', () => {
      expect(isBasketUndoPhrase('ruckgangig')).toBe(true);
      expect(isBasketUndoPhrase('rückgängig')).toBe(true);
      expect(isBasketUndoPhrase('Rückgängig')).toBe(true);
      expect(isBasketUndoPhrase('undo')).toBe(true);
      expect(isBasketUndoPhrase('geri al')).toBe(true);
      expect(isBasketUndoPhrase('2 döner')).toBe(false);
    });
  });

  describe('detectBotCommandAsync', () => {
    test('uses learned cache before LLM', async () => {
      await rememberLearnedCommand('mein order', BOT_COMMAND.VIEW_BASKET);
      const hit = await detectBotCommandAsync('mein order', { phone: '+431', hasBasket: true });
      expect(hit).toEqual({ command: BOT_COMMAND.VIEW_BASKET, source: 'learned' });
      expect(parseBotCommandWithLlm).not.toHaveBeenCalled();
    });

    test('calls LLM for ambiguous short phrase and caches result', async () => {
      canCallLlm.mockReturnValue(true);
      parseBotCommandWithLlm.mockResolvedValue({ command: 'view_basket', confidence: 0.95 });

      const hit = await detectBotCommandAsync('zeig mal', { phone: '+431', hasBasket: true });
      expect(hit).toEqual({ command: BOT_COMMAND.VIEW_BASKET, source: 'llm' });
      expect(parseBotCommandWithLlm).toHaveBeenCalled();

      canCallLlm.mockReturnValue(false);
      const cached = await detectBotCommandAsync('zeig mal', { phone: '+431', hasBasket: true });
      expect(cached).toEqual({ command: BOT_COMMAND.VIEW_BASKET, source: 'learned' });
    });

    test('does not learn undo without snapshot', async () => {
      canCallLlm.mockReturnValue(true);
      parseBotCommandWithLlm.mockResolvedValue({ command: 'undo', confidence: 0.95 });

      const hit = await detectBotCommandAsync('zurück', { phone: '+431', hasUndoSnapshot: false });
      expect(hit).toBeNull();
    });
  });
});
