jest.mock('../menuService', () => ({
  getMenuContext: jest.fn(),
  getBusinessInfo: jest.fn(),
}));
jest.mock('../../lib/whatsapp', () => ({
  sendText: jest.fn().mockResolvedValue('msg'),
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
    parseBasketOps: jest.fn(),
    persistBasketMutation: jest.fn().mockResolvedValue(undefined),
    logBasketOpTelemetry: jest.fn(),
  };
});
jest.mock('../intentLearning', () => ({
  buildBasketPendingLearning: jest.fn().mockReturnValue(null),
}));

const { getMenuContext, getBusinessInfo } = require('../menuService');
const { sendText } = require('../../lib/whatsapp');
const { sendDisambiguationList } = require('../intentDisambiguate');
const { startIntentCustomization } = require('../intentCustomize');
const { parseBasketOps, persistBasketMutation } = require('../basketOps');
const { buildMenuMatchIndex } = require('../menuMapper');
const { BUILTIN_MENU } = require('../intentSandbox');
const {
  parsePaymentKeyword,
  parseOrderTypeKeyword,
  isBareCheckoutDigit,
  tryCheckoutBasketOp,
} = require('../checkoutOps');

const MENU = [
  { id: 'd1', name: 'Döner', price: 8.5, available: true },
  { id: 'c1', name: 'Cola', price: 2.5, available: true },
];

const BASKET = [
  { name: 'Döner', qty: 1, price: 8.5 },
  { name: 'Cola', qty: 1, price: 2.5 },
];

const DUP_KEBAP_BASKET = [
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad, Zwiebel, Sauce', qty: 1, price: 7.5 },
  { name: 'Kebap Sandwich Huhn — Tomaten, Salad', qty: 1, price: 7.5 },
];

const BASE = {
  from: '+431234',
  session: { state: 'awaiting_name', businessId: 'biz_test' },
  lang: 'de',
  businessId: 'biz_test',
  basket: BASKET,
  text: 'noch ein cola',
  norm: 'noch ein cola',
  business: { conversationalBasket: true },
};

beforeEach(() => {
  jest.clearAllMocks();
  getMenuContext.mockResolvedValue({
    menu: MENU,
    menuMatch: buildMenuMatchIndex(MENU),
    menuTokenIndex: null,
  });
  getBusinessInfo.mockResolvedValue({
    avgPrepTime: 25,
    timezone: 'Europe/Vienna',
  });
});

describe('checkoutOps keywords', () => {
  test('parsePaymentKeyword', () => {
    expect(parsePaymentKeyword('karte')).toBe('card');
    expect(parsePaymentKeyword('bar')).toBe(null);
    expect(parsePaymentKeyword('nakit')).toBe(null);
    expect(parsePaymentKeyword('hamza')).toBe(null);
  });

  test('parseOrderTypeKeyword', () => {
    expect(parseOrderTypeKeyword('abholen')).toBe('pickup');
    expect(parseOrderTypeKeyword('lieferung')).toBe('delivery');
    expect(parseOrderTypeKeyword('paket')).toBe('delivery');
    expect(parseOrderTypeKeyword('max')).toBe(null);
  });

  test('isBareCheckoutDigit', () => {
    expect(isBareCheckoutDigit('1', 'confirming')).toBe(true);
    expect(isBareCheckoutDigit('1', 'awaiting_delivery_address')).toBe(false);
    expect(isBareCheckoutDigit('musterstraße 1', 'awaiting_name')).toBe(false);
  });
});

describe('tryCheckoutBasketOp', () => {
  test('returns false when conversational flag is off', async () => {
    const result = await tryCheckoutBasketOp({
      ...BASE,
      business: { conversationalBasket: false },
    });
    expect(result).toEqual({ handled: false });
    expect(parseBasketOps).not.toHaveBeenCalled();
  });

  test('returns false outside checkout basket-op states', async () => {
    const result = await tryCheckoutBasketOp({
      ...BASE,
      session: { ...BASE.session, state: 'browsing' },
    });
    expect(result).toEqual({ handled: false });
  });

  test('returns false when text does not look like an order', async () => {
    const result = await tryCheckoutBasketOp({
      ...BASE,
      text: 'hi',
      norm: 'hi',
    });
    expect(result).toEqual({ handled: false });
    expect(parseBasketOps).not.toHaveBeenCalled();
  });

  test('returns llm_failed when parse reports outage', async () => {
    parseBasketOps.mockResolvedValue({ outcome: 'llm_failed' });
    const result = await tryCheckoutBasketOp(BASE);
    expect(result).toEqual({ handled: 'llm_failed' });
  });

  test('returns no_match when parse finds nothing', async () => {
    parseBasketOps.mockResolvedValue({ outcome: 'no_match' });
    const result = await tryCheckoutBasketOp(BASE);
    expect(result).toEqual({ handled: 'no_match' });
  });

  test('routes disambiguation to pick-list', async () => {
    parseBasketOps.mockResolvedValue({
      outcome: 'disambiguation',
      disambiguation: { rawName: 'pizza', candidates: [] },
    });
    const result = await tryCheckoutBasketOp(BASE);
    expect(result.handled).toBe(true);
    expect(sendDisambiguationList).toHaveBeenCalled();
    expect(persistBasketMutation).toHaveBeenCalled();
  });

  test('starts customization when options are required', async () => {
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
    const result = await tryCheckoutBasketOp(BASE);
    expect(result.handled).toBe(true);
    expect(startIntentCustomization).toHaveBeenCalled();
  });

  test('applies basket ops and refreshes prep fields', async () => {
    parseBasketOps.mockResolvedValue({
      outcome: 'ops',
      ops: [{ type: 'add', item: { name: 'Cola', qty: 1, price: 2.5 } }],
      parsePath: 'local',
    });
    const result = await tryCheckoutBasketOp(BASE);
    expect(result.handled).toBe(true);
    expect(result.basket).toEqual([
      BASKET[0],
      { name: 'Cola', qty: 2, price: 2.5 },
    ]);
    expect(result.session).toEqual(expect.objectContaining({
      prepMins: 25,
      pickupTime: expect.any(String),
    }));
    expect(persistBasketMutation).toHaveBeenCalled();
  });

  test('handles ambiguous remove during checkout', async () => {
    parseBasketOps.mockResolvedValue({
      outcome: 'ops',
      ops: [{ type: 'remove', target: { kind: 'name', fragment: 'kebap sandwich huhn' } }],
      parsePath: 'local',
    });
    const result = await tryCheckoutBasketOp({
      ...BASE,
      basket: DUP_KEBAP_BASKET,
      text: 'kebap raus',
      norm: 'kebap raus',
    });
    expect(result.handled).toBe(true);
    expect(sendText).toHaveBeenCalled();
    expect(persistBasketMutation).toHaveBeenCalled();
  });

  test('returns basketCleared when ops empty the basket', async () => {
    parseBasketOps.mockResolvedValue({
      outcome: 'ops',
      ops: [{ type: 'clear' }],
      parsePath: 'local',
    });
    const result = await tryCheckoutBasketOp(BASE);
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      basket: [],
      basketCleared: true,
    }));
  });
});
