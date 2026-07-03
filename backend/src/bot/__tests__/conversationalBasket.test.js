jest.mock('../sessionStore', () => ({
  patchSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../intentLearning', () => ({
  lookupLearnedIntent: jest.fn().mockResolvedValue(null),
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

const { patchSession } = require('../sessionStore');
const { sendButtonMessage, sendText } = require('../../lib/whatsapp');
const { getMenuContext } = require('../menuService');
const { tryConversationalBasketText } = require('../conversationalBasket');
const { buildMenuMatchIndex } = require('../menuMapper');

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
