jest.mock('../sessionStore', () => ({
  patchSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../intentLearning', () => ({
  lookupLearnedIntent: jest.fn().mockResolvedValue(null),
  buildBasketPendingLearning: jest.fn().mockReturnValue(null),
  commitBasketPendingLearning: jest.fn(),
}));
jest.mock('../../lib/llm', () => ({
  canCallLlm: jest.fn().mockReturnValue(false),
}));
jest.mock('../orderEntry', () => ({
  sendOrderEntryPrompt: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/whatsapp', () => ({
  sendText: jest.fn().mockResolvedValue('msg_1'),
  sendButtonMessage: jest.fn().mockResolvedValue('msg_2'),
}));
jest.mock('../menuService', () => ({
  getMenuContext: jest.fn(),
}));
jest.mock('../intentDisambiguate', () => ({
  sendDisambiguationList: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../intentCustomize', () => {
  const actual = jest.requireActual('../intentCustomize');
  return {
    ...actual,
    startIntentCustomization: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../basketOps', () => {
  const actual = jest.requireActual('../basketOps');
  return {
    ...actual,
    parseBasketOps: jest.fn((text, ctx) => actual.parseBasketOps(text, ctx)),
  };
});

const { patchSession } = require('../sessionStore');
const {
  buildBasketPendingLearning,
  commitBasketPendingLearning,
} = require('../intentLearning');
const { sendButtonMessage, sendText } = require('../../lib/whatsapp');
const { getMenuContext } = require('../menuService');
const { sendOrderEntryPrompt } = require('../orderEntry');
const { sendDisambiguationList } = require('../intentDisambiguate');
const { startIntentCustomization } = require('../intentCustomize');
const { parseBasketOps } = require('../basketOps');
const {
  tryConversationalBasketText,
  tryBasketUndo,
  applyConversationalOps,
  isBasketUndoPhrase,
  flushBasketPendingLearning,
} = require('../conversationalBasket');
const { buildMenuMatchIndex } = require('../menuMapper');
const { BUILTIN_MENU } = require('../intentSandbox');

const MENU = [
  { id: 'd1', name: 'Döner', price: 8.5, available: true },
  { id: 'a1', name: 'Ayran', price: 2, available: true },
  { id: 'c1', name: 'Cola', price: 2.5, available: true },
];

const BASKET = [
  { name: 'Döner', qty: 1, price: 8.5 },
  { name: 'Cola', qty: 1, price: 2.5 },
  { name: 'Ayran', qty: 1, price: 2 },
];

const BASE = {
  from: '+431234',
  session: { state: 'browsing', businessId: 'biz_test' },
  lang: 'de',
  businessId: 'biz_test',
  basket: BASKET,
  norm: 'cola raus',
};

beforeEach(() => {
  jest.clearAllMocks();
  const actual = jest.requireActual('../basketOps');
  parseBasketOps.mockImplementation((text, ctx) => actual.parseBasketOps(text, ctx));
  getMenuContext.mockResolvedValue({
    menu: MENU,
    menuMatch: buildMenuMatchIndex(MENU),
    menuTokenIndex: null,
  });
});

describe('tryConversationalBasketText', () => {
  test('returns false when flag is off', async () => {
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: 'cola raus',
      business: { name: 'Test' },
    });
    expect(handled).toBe(false);
    expect(patchSession).not.toHaveBeenCalled();
  });

  test('removes line by plain text without Entfernen tap', async () => {
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: 'cola raus',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        basket: [
          { name: 'Döner', qty: 1, price: 8.5 },
          { name: 'Ayran', qty: 1, price: 2 },
        ],
        pendingIntentItems: undefined,
      }),
      BASE.session,
    );
    expect(sendButtonMessage).toHaveBeenCalled();
    expect(sendButtonMessage).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        body: expect.stringMatching(/entfernt/i),
      }),
    );
    expect(sendText).not.toHaveBeenCalledWith(BASE.from, expect.stringContaining('Zum Warenkorb hinzufügen'));
  });

  test('re-quantifies by mach 2 döner', async () => {
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: 'mach 2 döner',
      norm: 'mach 2 döner',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        basket: expect.arrayContaining([
          expect.objectContaining({ name: 'Döner', qty: 2 }),
        ]),
      }),
      BASE.session,
    );
    expect(sendButtonMessage).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        body: expect.stringMatching(/→ 2×/),
      }),
    );
  });

  test('stores undo snapshot on mutation', async () => {
    await tryConversationalBasketText({
      ...BASE,
      text: 'cola raus',
      business: { conversationalBasket: true },
    });
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        basketUndoSnapshot: { basket: BASKET },
      }),
      BASE.session,
    );
  });

  test('undo restores prior basket', async () => {
    const session = {
      ...BASE.session,
      basket: [
        { name: 'Döner', qty: 1, price: 8.5 },
        { name: 'Ayran', qty: 1, price: 2 },
      ],
      basketUndoSnapshot: { basket: BASKET },
    };
    const handled = await tryBasketUndo({
      ...BASE,
      session,
      basket: session.basket,
      norm: 'ruckgangig',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        basket: BASKET,
        basketUndoSnapshot: undefined,
      }),
      session,
    );
    expect(sendButtonMessage).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        body: expect.stringMatching(/Rückgängig/i),
      }),
    );
  });

  test('adds via noch ein ayran without confirm tap', async () => {
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: 'noch ein ayran',
      norm: 'noch ein ayran',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        basket: expect.arrayContaining([
          expect.objectContaining({ name: 'Ayran', qty: 2 }),
        ]),
      }),
      BASE.session,
    );
    expect(sendButtonMessage).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        body: expect.stringMatching(/Ayran/i),
      }),
    );
  });
});

describe('isBasketUndoPhrase', () => {
  test('matches undo phrases', () => {
    expect(isBasketUndoPhrase('ruckgangig')).toBe(true);
    expect(isBasketUndoPhrase('undo')).toBe(true);
    expect(isBasketUndoPhrase('geri al')).toBe(true);
    expect(isBasketUndoPhrase('2 döner')).toBe(false);
  });
});

describe('applyConversationalOps', () => {
  test('prompts ambiguous remove when ops rejected', async () => {
    const dupBasket = [
      { name: 'Döner — mit allem', qty: 1, price: 8.5 },
      { name: 'Döner — ohne', qty: 1, price: 8.5 },
    ];
    const handled = await applyConversationalOps({
      ...BASE,
      basket: dupBasket,
      applyResult: {
        basket: dupBasket,
        applied: [],
        rejected: [{ reason: 'ambiguous', indices: [1, 2], fragment: 'döner' }],
        diff: {},
      },
    });
    expect(handled).toBe(true);
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({
        basketRemoveDisambig: { fragment: 'döner', indices: [1, 2] },
      }),
      BASE.session,
    );
    expect(sendText).toHaveBeenCalled();
  });

  test('returns false when nothing applied and not ambiguous', async () => {
    const handled = await applyConversationalOps({
      ...BASE,
      applyResult: {
        basket: BASKET,
        applied: [],
        rejected: [{ reason: 'not_found' }],
        diff: {},
      },
    });
    expect(handled).toBe(false);
  });

  test('opens order entry when basket cleared', async () => {
    const handled = await applyConversationalOps({
      ...BASE,
      applyResult: {
        basket: [],
        applied: [{ kind: 'clear', removedCount: 3 }],
        rejected: [],
        diff: { cleared: true },
      },
    });
    expect(handled).toBe(true);
    expect(sendOrderEntryPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ basket: [], bodyOverride: expect.stringMatching(/leer/i) }),
    );
  });
});

describe('flushBasketPendingLearning', () => {
  test('commits and clears pending learning', async () => {
    const pending = {
      businessId: 'biz_test',
      text: 'cola raus',
      intent: { operation: 'remove', parsedBy: 'rules' },
      matched: [{ name: 'Cola', qty: 1 }],
    };
    const session = { ...BASE.session, basketPendingLearning: pending };
    const next = await flushBasketPendingLearning(BASE.from, session);
    expect(commitBasketPendingLearning).toHaveBeenCalledWith(pending);
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      { basketPendingLearning: undefined },
      session,
    );
    expect(next.basketPendingLearning).toBeUndefined();
  });
});

describe('tryBasketUndo edge cases', () => {
  test('undo clears basketPendingLearning without committing', async () => {
    const session = {
      ...BASE.session,
      basket: [
        { name: 'Döner', qty: 1, price: 8.5 },
        { name: 'Ayran', qty: 1, price: 2 },
      ],
      basketUndoSnapshot: { basket: BASKET },
      basketPendingLearning: {
        businessId: 'biz_test',
        text: 'cola raus',
        intent: { operation: 'remove', parsedBy: 'rules' },
        matched: [{ name: 'Cola', qty: 1 }],
      },
    };
    await tryBasketUndo({
      ...BASE,
      session,
      basket: session.basket,
      norm: 'undo',
      business: { conversationalBasket: true },
    });
    expect(patchSession).toHaveBeenCalledWith(
      BASE.from,
      expect.objectContaining({ basketPendingLearning: undefined }),
      session,
    );
    expect(commitBasketPendingLearning).not.toHaveBeenCalled();
  });

  test('returns false when flag is off', async () => {
    expect(await tryBasketUndo({
      ...BASE, norm: 'undo', business: { name: 'Test' },
    })).toBe(false);
  });

  test('replies when nothing to undo', async () => {
    const handled = await tryBasketUndo({
      ...BASE,
      norm: 'undo',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(sendText).toHaveBeenCalledWith(BASE.from, expect.stringMatching(/Rückgängig/i));
  });

  test('opens order entry when undo restores empty basket', async () => {
    const session = {
      ...BASE.session,
      basketUndoSnapshot: { basket: [] },
    };
    const handled = await tryBasketUndo({
      ...BASE,
      session,
      norm: 'undo',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(sendOrderEntryPrompt).toHaveBeenCalled();
  });
});

describe('tryConversationalBasketText branches', () => {
  test('returns llm_failed when parse reports outage', async () => {
    parseBasketOps.mockResolvedValue({ outcome: 'llm_failed' });
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: '2 döner',
      norm: '2 döner',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe('llm_failed');
  });

  test('routes disambiguation to pick-list', async () => {
    parseBasketOps.mockResolvedValue({
      outcome: 'disambiguation',
      disambiguation: { rawName: 'pizza', candidates: [] },
    });
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: 'pizza',
      norm: 'pizza',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(sendDisambiguationList).toHaveBeenCalled();
  });

  test('starts customization wizard when options required', async () => {
    const menuMatch = buildMenuMatchIndex(BUILTIN_MENU);
    getMenuContext.mockResolvedValue({
      menu: BUILTIN_MENU,
      menuMatch,
      menuTokenIndex: null,
    });
    parseBasketOps.mockResolvedValue({
      outcome: 'needs_customize',
      matched: [{
        menuItemId: 'd1',
        name: 'Döner',
        qty: 1,
        price: 8.5,
        optionGroups: BUILTIN_MENU.find(i => i.id === 'd1').optionGroups,
      }],
    });
    const handled = await tryConversationalBasketText({
      ...BASE,
      text: '1 döner mit allem',
      norm: '1 döner mit allem',
      business: { conversationalBasket: true },
    });
    expect(handled).toBe(true);
    expect(startIntentCustomization).toHaveBeenCalled();
  });
});
