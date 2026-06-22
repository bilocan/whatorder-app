jest.mock('../sessionStore', () => ({
  getSession: jest.fn(),
  patchSession: jest.fn(),
}));
jest.mock('../menuService', () => ({
  getMenu: jest.fn(),
}));

const { getSession, patchSession } = require('../sessionStore');
const { getMenu } = require('../menuService');
const { applyKeypadAction } = require('../keypadApply');

const MENU = [
  { id: '1', name: 'Döner', price: 8.5, aliases: ['doner'] },
  { id: '2', name: 'Cola', price: 2.5, aliases: ['coke'] },
  { id: '3', name: 'Ayran', price: 2, aliases: [] },
];

function mockSession(initial = {}) {
  let session = { state: 'browsing', basket: [], ...initial };
  getSession.mockImplementation(async () => session);
  patchSession.mockImplementation(async (_phone, patch) => {
    session = { ...session, ...patch };
  });
  return () => session;
}

describe('applyKeypadAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMenu.mockResolvedValue(MENU);
  });

  test('add by text merges into basket', async () => {
    mockSession();
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'add', {
      text: '2x döner',
    });
    expect(result.ok).toBe(true);
    expect(result.context.basketCount).toBe(1);
    expect(result.context.basket[0]).toMatchObject({ name: 'Döner', qty: 2 });
    expect(patchSession).toHaveBeenCalled();
  });

  test('add by menuItemId', async () => {
    mockSession();
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'add', {
      menuItemId: '3',
      qty: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.context.basket[0].name).toBe('Ayran');
  });

  test('add returns disambiguation when ambiguous', async () => {
    getMenu.mockResolvedValue([
      { id: '1', name: 'Döner', price: 8.5 },
      { id: '2', name: 'Döner Box', price: 9.5 },
    ]);
    mockSession();
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'add', {
      text: 'döner',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('disambiguation');
    expect(result.choices.length).toBeGreaterThan(1);
  });

  test('clear empties basket', async () => {
    mockSession({
      basket: [{ name: 'Cola', qty: 1, price: 2.5, menuItemId: '2' }],
    });
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'clear');
    expect(result.ok).toBe(true);
    expect(result.context.basketCount).toBe(0);
  });

  test('checkout opens WhatsApp when basket has items', async () => {
    mockSession({
      basket: [{ name: 'Cola', qty: 1, price: 2.5 }],
    });
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'checkout');
    expect(result.ok).toBe(true);
    expect(result.openWhatsApp).toBe(true);
    expect(result.waText).toBe('checkout');
  });

  test('checkout fails on empty basket', async () => {
    mockSession();
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'checkout');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty_basket');
  });

  test('confirm_proposal merges pending items', async () => {
    mockSession({
      pendingIntentItems: [{ menuItemId: '2', name: 'Cola', qty: 1, price: 2.5 }],
    });
    const result = await applyKeypadAction('436601111111', 'biz1', 'en', 'confirm_proposal');
    expect(result.ok).toBe(true);
    expect(result.context.basketCount).toBe(1);
    expect(result.context.pendingProposal).toEqual([]);
  });
});
