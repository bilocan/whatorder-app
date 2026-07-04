jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/flowCrypto', () => ({
  decryptRequest: jest.fn(body => ({ body, aesKey: Buffer.alloc(16), iv: Buffer.alloc(16) })),
  encryptResponse: jest.fn((data) => JSON.stringify(data)),
}));
jest.mock('../../bot/menuService');
jest.mock('../../lib/collections');

const request = require('supertest');
const app = require('../../index');
const { getMenu } = require('../../bot/menuService');
const { sessionRef } = require('../../lib/collections');
const { decryptRequest } = require('../../lib/flowCrypto');
const { SCREENS: S, FIELDS: F } = require('../../flows/fields');

const TOKEN = 'phone1|biz1';
const V = '3.0';

const MENU = [
  { id: 'b1', name: 'Burger', price: 10, category: 'mains', description: 'Tasty' },
  { id: 'f1', name: 'Fries',  price: 5,  category: 'sides' },
  {
    id: 'p1', name: 'Pizza', price: 15, category: 'mains',
    optionGroups: [
      { id: 'size', type: 'single', label: 'Size', required: true, options: [{ id: 's', label: 'Small' }, { id: 'l', label: 'Large' }] },
      { id: 'extras', type: 'multi', label: 'Extras', required: false, options: [{ id: 'cheese', label: 'Cheese', price: 2.5 }] },
    ],
  },
];

function mockSession(basket = []) {
  const snap = { exists: basket.length > 0, data: () => ({ basket }) };
  const ref  = { get: jest.fn().mockResolvedValue(snap), set: jest.fn().mockResolvedValue(undefined) };
  sessionRef.mockReturnValue(ref);
  return ref;
}

function post(body) {
  return request(app).post('/flow/exchange').send(body).set('Content-Type', 'application/json');
}

function parsed(res) {
  return JSON.parse(res.text);
}

beforeEach(() => {
  jest.clearAllMocks();
  getMenu.mockResolvedValue(MENU);
  mockSession();
});

// ── ping ──────────────────────────────────────────────────────────────────────

test('ping → active status', async () => {
  const res = await post({ action: 'ping', version: V, flow_token: TOKEN });
  expect(res.status).toBe(200);
  expect(parsed(res)).toMatchObject({ data: { status: 'active' } });
});

// ── invalid token ─────────────────────────────────────────────────────────────

test('missing businessId in flow_token → 400', async () => {
  const res = await post({ action: 'INIT', version: V, flow_token: 'nopipe' });
  expect(res.status).toBe(400);
});

test('empty flow_token → 400', async () => {
  const res = await post({ action: 'INIT', version: V, flow_token: '' });
  expect(res.status).toBe(400);
});

// ── INIT ──────────────────────────────────────────────────────────────────────

test('INIT empty basket → CATEGORY_SELECT with unique categories', async () => {
  mockSession([]);
  const res = await post({ action: 'INIT', version: V, flow_token: TOKEN });
  const body = parsed(res);
  expect(body.screen).toBe(S.CATEGORY_SELECT);
  // mains + sides = 2 unique categories
  expect(body.data[F.CATEGORIES]).toHaveLength(2);
});

test('INIT non-empty basket → CART_REVIEW', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  const res = await post({ action: 'INIT', version: V, flow_token: TOKEN });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  expect(body.data[F.BASKET_ITEMS]).toBeDefined();
  expect(body.data[F.TOTAL_LABEL]).toContain('10.00');
});

// ── CATEGORY_SELECT → MENU_BROWSE ─────────────────────────────────────────────

test('CATEGORY_SELECT → MENU_BROWSE filters by category', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.CATEGORY_SELECT, version: V, flow_token: TOKEN,
    data: { [F.CATEGORY_ID]: 'mains' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.MENU_BROWSE);
  expect(body.data[F.MENU_ITEMS]).toHaveLength(2);
  // item with description uses "— description" format; item without does not
  const burger = body.data[F.MENU_ITEMS].find(i => i.id === 'b1');
  expect(burger.description).toContain('Tasty');
  const pizza = body.data[F.MENU_ITEMS].find(i => i.id === 'p1');
  expect(pizza.description).not.toContain('—');
});

// ── MENU_BROWSE → ORDER_ITEM ──────────────────────────────────────────────────

test('MENU_BROWSE → ORDER_ITEM with no option groups', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.ITEM_NAME]).toBe('Burger');
  expect(body.data[F.QTY_OPTIONS]).toEqual([{ id: '1', title: '1' }, { id: '2', title: '2' }, { id: '3', title: '3' }]);
  expect(body.data[F.SLOT1_VISIBLE]).toBe(false);
  expect(body.data[F.MULTI_VISIBLE]).toBe(false);
});

test('MENU_BROWSE → ORDER_ITEM with single + multi option groups', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'p1' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.SLOT1_VISIBLE]).toBe(true);
  expect(body.data[F.SLOT1_LABEL]).toBe('Size');
  expect(body.data[F.SLOT2_VISIBLE]).toBe(false);
  expect(body.data[F.MULTI_VISIBLE]).toBe(true);
  expect(body.data[F.MULTI_LABEL]).toBe('Extras');
});

test('MENU_BROWSE unknown item → 500', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'missing' },
  });
  expect(res.status).toBe(500);
});

// ── ORDER_ITEM → CART_REVIEW ──────────────────────────────────────────────────

test('ORDER_ITEM adds plain item to empty basket', async () => {
  const ref = mockSession([]);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: '2' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(1);
  expect(saved.basket[0]).toMatchObject({ name: 'Burger', qty: 2, price: 10 });
});

test('ORDER_ITEM merges qty when same item name already in basket', async () => {
  const ref = mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: '1' },
  });
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket[0].qty).toBe(2);
});

test('ORDER_ITEM with slot value + multi value + notes builds custom name', async () => {
  const ref = mockSession([]);
  await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: {
      [F.ITEM_ID]:    'p1',
      [F.QTY]:        '1',
      [F.SLOT1_VALUE]: 'l',
      [F.MULTI_VALUE]: ['cheese'],
      [F.NOTES]:      'extra crispy',
    },
  });
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket[0].name).toContain('Large');
  expect(saved.basket[0].name).toContain('Cheese');
  expect(saved.basket[0].name).toContain('extra crispy');
  expect(saved.basket[0].price).toBe(17.5);
});

test('ORDER_ITEM shows priced extras in option titles', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'p1' },
  });
  const body = parsed(res);
  expect(body.data[F.MULTI_OPTIONS][0].title).toContain('+€2.50');
});

test('ORDER_ITEM clamps qty to 1 when invalid', async () => {
  const ref = mockSession([]);
  await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: 'abc' },
  });
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket[0].qty).toBe(1);
});

test('CART_REVIEW basket item title truncated at 30 chars', async () => {
  // "1x " (3) + 35 "A"s = 38 chars > 30 → truncated to slice(0,28) + "…" = 29 chars
  const longName = 'A'.repeat(35);
  mockSession([{ name: longName, qty: 1, price: 5 }]);
  const res = await post({ action: 'INIT', version: V, flow_token: TOKEN });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  const displayTitle = body.data[F.BASKET_ITEMS][0].title;
  expect(displayTitle.length).toBeLessThanOrEqual(30);
  expect(displayTitle).toContain('…');
});

// ── CART_REVIEW (editable cart round 1) ──────────────────────────────────────

const BASKET2 = [{ name: 'Burger', qty: 1, price: 10 }, { name: 'Fries', qty: 2, price: 5 }];

test('CART_REVIEW add_more → CATEGORY_SELECT_RETURN', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'add_more' },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
});

test('CART_REVIEW remove_items by index → CART_UPDATED', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: ['0'] },
  });
  expect(parsed(res).screen).toBe(S.CART_UPDATED);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(1);
  expect(saved.basket[0].name).toBe('Fries');
});

test('CART_REVIEW remove_items string (not array) → treated as single id', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: '1' },
  });
  expect(parsed(res).screen).toBe(S.CART_UPDATED);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(1);
});

test('CART_REVIEW remove_items clear → empty basket → CATEGORY_SELECT_RETURN', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: ['clear'] },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(0);
});

test('CART_REVIEW remove_items makes basket empty → CATEGORY_SELECT_RETURN', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: ['0'] },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
});

test('CART_REVIEW remove_items empty array → passthrough → CART_UPDATED', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: [] },
  });
  expect(parsed(res).screen).toBe(S.CART_UPDATED);
});

test('CART_REVIEW fallback (no cart_action) → CART_UPDATED', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {},
  });
  expect(parsed(res).screen).toBe(S.CART_UPDATED);
});

// ── CART_UPDATED (editable cart round 2) ─────────────────────────────────────

test('CART_UPDATED remove_items → CART_DONE with basket summary', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_UPDATED, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: ['0'] },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_DONE);
  expect(body.data[F.BASKET_TEXT]).toBeDefined();
  expect(body.data[F.TOTAL_LABEL]).toBeDefined();
});

test('CART_UPDATED fallback → CART_DONE', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_UPDATED, version: V, flow_token: TOKEN,
    data: {},
  });
  expect(parsed(res).screen).toBe(S.CART_DONE);
});

// ── CART_DONE ─────────────────────────────────────────────────────────────────

test('CART_DONE → CATEGORY_SELECT_RETURN', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.CART_DONE, version: V, flow_token: TOKEN,
    data: {},
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
});

// ── CATEGORY_SELECT_RETURN → MENU_BROWSE ─────────────────────────────────────

test('CATEGORY_SELECT_RETURN → MENU_BROWSE filters by category', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.CATEGORY_SELECT_RETURN, version: V, flow_token: TOKEN,
    data: { [F.CATEGORY_ID]: 'sides' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.MENU_BROWSE);
  expect(body.data[F.MENU_ITEMS]).toHaveLength(1);
  expect(body.data[F.MENU_ITEMS][0].id).toBe('f1');
});

// ── error handling ────────────────────────────────────────────────────────────

test('unhandled action/screen → 400', async () => {
  const res = await post({
    action: 'data_exchange', screen: 'UNKNOWN', version: V, flow_token: TOKEN,
    data: {},
  });
  expect(res.status).toBe(400);
});

test('decryption failure (no aesKey) → 421', async () => {
  decryptRequest.mockImplementationOnce(() => { throw new Error('bad decrypt'); });
  const res = await post({ garbage: true });
  expect(res.status).toBe(421);
});

test('post-decryption error (aesKey present) → 500', async () => {
  getMenu.mockRejectedValueOnce(new Error('firestore down'));
  const res = await post({
    action: 'INIT', version: V, flow_token: TOKEN,
  });
  // session get succeeds (empty basket), then getMenu throws → aesKey is set → 500
  expect(res.status).toBe(500);
});
