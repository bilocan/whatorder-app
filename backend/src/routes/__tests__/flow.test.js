jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/flowCrypto', () => ({
  decryptRequest: jest.fn(body => ({ body, aesKey: Buffer.alloc(16), iv: Buffer.alloc(16) })),
  encryptResponse: jest.fn((data) => JSON.stringify(data)),
}));
jest.mock('../../bot/menuService');
jest.mock('../../lib/collections');
jest.mock('../../lib/flowImages', () => ({
  attachCategoryImages: jest.fn(async (cats) => cats.map(c => ({
    ...c,
    image: `img_${c.id}`,
    'alt-text': c.title,
  }))),
  attachMenuItemImages: jest.fn(async (items) => items.map(i => ({
    ...i,
    image: `img_${i.id}`,
    'alt-text': i.title,
  }))),
}));

const request = require('supertest');
const app = require('../../index');
const { getMenu, getBusinessInfo } = require('../../bot/menuService');
const { sessionRef, customersRef } = require('../../lib/collections');
const { decryptRequest } = require('../../lib/flowCrypto');
const { SCREENS: S, FIELDS: F } = require('../../flows/fields');
const { attachCategoryImages, attachMenuItemImages } = require('../../lib/flowImages');
const { checkoutFlowToken } = require('../../bot/checkoutConfirmFlow');

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

function mockSession(basket = [], extras = {}) {
  const snap = { exists: basket.length > 0 || Object.keys(extras).length > 0, data: () => ({ basket, ...extras }) };
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
  customersRef.mockReturnValue({
    doc: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          savedAddresses: ['Main Street 12, Top 2, 1010 Wien'],
          lastDeliveryAddress: 'Main Street 12, Top 2, 1010 Wien',
        }),
      }),
    }),
  });
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
  expect(attachCategoryImages).toHaveBeenCalled();
  expect(body.data[F.CATEGORIES][0].image).toBeTruthy();
  expect(body.data[F.CATEGORIES][0]['alt-text']).toBeTruthy();
});

test('INIT uses session language for Flow UI chrome (de/en/tr)', async () => {
  mockSession([], { language: 'de' });
  const de = parsed(await post({ action: 'INIT', version: V, flow_token: TOKEN }));
  expect(de.data[F.UI_SCREEN_TITLE]).toBe('Speisekarte');
  expect(de.data[F.UI_CATEGORY_PROMPT]).toBe('Was möchten Sie?');
  expect(de.data[F.UI_NEXT]).toBe('Weiter');
  expect(de.data[F.CATEGORIES].map(c => c.title)).toEqual(
    expect.arrayContaining(['Hauptgerichte', 'Beilagen']),
  );

  mockSession([], { language: 'en' });
  const en = parsed(await post({ action: 'INIT', version: V, flow_token: TOKEN }));
  expect(en.data[F.UI_SCREEN_TITLE]).toBe('Menu');
  expect(en.data[F.UI_CATEGORY_PROMPT]).toBe('What would you like?');
  expect(en.data[F.CATEGORIES].map(c => c.title)).toEqual(
    expect.arrayContaining(['Mains', 'Sides']),
  );

  mockSession([], { language: 'tr' });
  const tr = parsed(await post({ action: 'INIT', version: V, flow_token: TOKEN }));
  expect(tr.data[F.UI_SCREEN_TITLE]).toBe('Menü');
  expect(tr.data[F.UI_NEXT]).toBe('İleri');
  expect(tr.data[F.CATEGORIES].map(c => c.title)).toEqual(
    expect.arrayContaining(['Ana Yemekler', 'Garnitürler']),
  );
});

test('ORDER_ITEM → CART_REVIEW localizes total and clear-cart row', async () => {
  mockSession([], { language: 'de' });
  const res = await post({
    action: 'data_exchange',
    screen: S.ORDER_ITEM,
    version: V,
    flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: '1' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  expect(body.data[F.UI_SCREEN_TITLE]).toBe('Warenkorb');
  expect(body.data[F.TOTAL_LABEL]).toBe('Gesamt: €10.00');
  expect(body.data[F.UI_PLACE_ORDER]).toBe('Bestellung aufgeben');
  expect(body.data[F.BASKET_ITEMS].find(i => i.id === 'clear').title).toBe(
    'Gesamten Warenkorb leeren',
  );
});

test('INIT with basket still opens CATEGORY_SELECT (CART_REVIEW is not a valid entry screen)', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  const res = await post({ action: 'INIT', version: V, flow_token: TOKEN });
  const body = parsed(res);
  expect(body.screen).toBe(S.CATEGORY_SELECT);
  expect(body.data[F.CATEGORIES]).toHaveLength(2);
  expect(attachCategoryImages).toHaveBeenCalled();
});

test('checkout INIT → CHECKOUT_REVIEW with session prefill', async () => {
  const session = {
    businessId: 'biz1',
    language: 'en',
    basket: [{ name: 'Burger', qty: 1, price: 10 }],
    customerName: 'Alex',
    orderType: 'delivery',
    deliveryAddress: 'Main Street 12',
    specialRequests: 'Ring twice',
  };
  const ref = {
    get: jest.fn().mockResolvedValue({ exists: true, data: () => session }),
    set: jest.fn(),
  };
  sessionRef.mockReturnValue(ref);
  getBusinessInfo.mockResolvedValue({
    name: 'Test Bistro',
    deliveryEnabled: true,
    deliveryFee: 2.5,
  });

  const res = await post({
    action: 'INIT',
    version: V,
    flow_token: checkoutFlowToken('phone1', 'biz1'),
  });
  const body = parsed(res);

  expect(body.screen).toBe(S.CHECKOUT_REVIEW);
  expect(body.data).toMatchObject({
    [F.CUSTOMER_NAME]: 'Alex',
    [F.ORDER_TYPE]: 'delivery',
    [F.DELIVERY_ADDRESS]: 'Main Street 12',
    [F.CHECKOUT_NOTE]: 'Ring twice',
  });
  expect(body.data[F.RECEIPT_TEXT]).toContain('Test Bistro');
  expect(getBusinessInfo).toHaveBeenCalledWith('biz1');
  expect(getMenu).not.toHaveBeenCalled();
  expect(ref.set).not.toHaveBeenCalled();
});

test('checkout INIT with a foreign businessId returns a neutral screen without session PII', async () => {
  const ref = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        language: 'en',
        businessId: 'other-biz',
        basket: [{ name: 'Burger', qty: 1, price: 10 }],
        customerName: 'Alex',
        deliveryAddress: 'Main Street 12',
        specialRequests: 'Ring twice',
      }),
    }),
    set: jest.fn(),
  };
  sessionRef.mockReturnValue(ref);
  getBusinessInfo.mockResolvedValue({ name: 'Test Bistro', deliveryEnabled: true });

  const res = await post({
    action: 'INIT',
    version: V,
    flow_token: checkoutFlowToken('phone1', 'biz1'),
  });
  const body = parsed(res);

  expect(body.screen).toBe(S.CHECKOUT_REVIEW);
  expect(body.data[F.CUSTOMER_NAME]).toBe('');
  expect(body.data[F.DELIVERY_ADDRESS]).toBe('');
  expect(body.data[F.CHECKOUT_NOTE]).toBe('');
  expect(body.data[F.RECEIPT_TEXT]).not.toContain('Alex');
  expect(body.data[F.RECEIPT_TEXT]).not.toContain('Main Street 12');
  expect(body.data[F.RECEIPT_TEXT]).not.toContain('Burger');
  expect(ref.set).not.toHaveBeenCalled();
});

test('checkout INIT with empty basket still returns CHECKOUT_REVIEW', async () => {
  const ref = {
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ language: 'de', basket: [] }),
    }),
    set: jest.fn(),
  };
  sessionRef.mockReturnValue(ref);
  getBusinessInfo.mockResolvedValue({ name: 'Empty Bistro', deliveryEnabled: false });

  const res = await post({
    action: 'INIT',
    version: V,
    flow_token: checkoutFlowToken('phone1', 'biz1'),
  });

  expect(parsed(res).screen).toBe(S.CHECKOUT_REVIEW);
  expect(ref.set).not.toHaveBeenCalled();
});

test('checkout data_exchange back_to_cart → SUCCESS with checkout_action', async () => {
  const token = checkoutFlowToken('phone1', 'biz1');
  const res = await post({
    action: 'data_exchange',
    screen: S.CHECKOUT_REVIEW,
    version: V,
    flow_token: token,
    data: { checkout_action: 'back_to_cart' },
  });
  const body = parsed(res);
  expect(body.screen).toBe('SUCCESS');
  expect(body.data.extension_message_response.params).toEqual({
    flow_token: token,
    checkout_action: 'back_to_cart',
  });
});

test('checkout data_exchange routes review return screens to address management', async () => {
  const res = await post({
    action: 'data_exchange',
    screen: S.CHECKOUT_REVIEW_RETURN,
    version: V,
    flow_token: checkoutFlowToken('phone1', 'biz1'),
    data: { checkout_action: 'manage_addresses' },
  });

  expect(res.status).toBe(200);
  expect(parsed(res).screen).toBe(S.ADDRESS_MANAGE_AGAIN);
});

test('checkout data_exchange on a non-checkout screen bypasses checkout routing', async () => {
  const res = await post({
    action: 'data_exchange',
    screen: S.CART_REVIEW,
    version: V,
    flow_token: checkoutFlowToken('phone1', 'biz1'),
    data: { checkout_action: 'manage_addresses' },
  });

  expect(parsed(res).screen).toBe(S.CART_UPDATED);
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
  expect(attachMenuItemImages).toHaveBeenCalled();
  // item with description uses "— description" format; item without does not
  const burger = body.data[F.MENU_ITEMS].find(i => i.id === 'b1');
  expect(burger.description).toContain('Tasty');
  expect(burger.image).toBe('img_b1');
  expect(burger['alt-text']).toBe('Burger');
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
  getMenu.mockResolvedValue([{ id: 'long1', name: longName, price: 5, category: 'mains', available: true }]);
  mockSession([]);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'long1', [F.QTY]: '1' },
  });
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
