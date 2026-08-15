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
  attachListImages: jest.fn(async (items) => items.map(i => ({
    ...i,
    image: `img_${i.id}`,
    'alt-text': i.title,
  }))),
}));
jest.mock('../../bot/checkoutDeal', () => ({
  loadCheckoutTotals: jest.fn(async ({ basket, session = {}, info = {} }) => {
    const subtotal = (basket ?? []).reduce((s, i) => s + i.price * i.qty, 0);
    const isDelivery = session.orderType === 'delivery';
    const deliveryFee = isDelivery ? (info.deliveryFee || 0) : 0;
    return {
      subtotal,
      deliveryFee,
      discount: 0,
      total: subtotal + deliveryFee,
      isDelivery,
      deal: null,
    };
  }),
  checkoutDealLines: jest.fn(() => ''),
  chargedCustomerTotal: jest.fn((tax, fallback) => (
    typeof tax?.totalGross === 'number' ? tax.totalGross : fallback
  )),
}));

const request = require('supertest');
const app = require('../../index');
const { getMenu, getBusinessInfo } = require('../../bot/menuService');
const { sessionRef, customersRef } = require('../../lib/collections');
const { decryptRequest } = require('../../lib/flowCrypto');
const { SCREENS: S, FIELDS: F } = require('../../flows/fields');
const { attachCategoryImages, attachMenuItemImages, attachListImages } = require('../../lib/flowImages');
const { checkoutFlowToken } = require('../../bot/checkoutConfirmFlow');
const { loadCheckoutTotals } = require('../../bot/checkoutDeal');

const TOKEN = 'phone1|biz1';
const V = '3.0';

const MENU = [
  { id: 'b1', name: 'Burger', price: 10, category: 'mains', description: 'Tasty', flowListImage: 'thumb_b1' },
  { id: 'f1', name: 'Fries',  price: 5,  category: 'sides' },
  {
    id: 'p1', name: 'Pizza', price: 15, category: 'mains',
    optionGroups: [
      { id: 'size', type: 'single', label: 'Size', required: true, options: [{ id: 's', label: 'Small' }, { id: 'l', label: 'Large' }] },
      {
        id: 'extras', type: 'multi', label: 'Extras', required: false, multiDefault: 'all',
        options: [{ id: 'cheese', label: 'Cheese', price: 2.5 }],
      },
    ],
  },
  {
    id: 'p2', name: 'Pizza Plain', price: 12, category: 'mains',
    optionGroups: [
      {
        id: 'tops', type: 'multi', label: 'Toppings', required: false, multiDefault: 'none',
        options: [{ id: 'onion', label: 'Onion' }, { id: 'olive', label: 'Olive' }],
      },
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
  getBusinessInfo.mockResolvedValue({ deliveryFee: 0 });
  loadCheckoutTotals.mockImplementation(async ({ basket, session = {}, info = {} }) => {
    const subtotal = (basket ?? []).reduce((s, i) => s + i.price * i.qty, 0);
    const isDelivery = session.orderType === 'delivery';
    const deliveryFee = isDelivery ? (info.deliveryFee || 0) : 0;
    return {
      subtotal,
      deliveryFee,
      discount: 0,
      total: subtotal + deliveryFee,
      isDelivery,
      deal: null,
    };
  });
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

test('ORDER_ITEM → CART_REVIEW localizes total without clear-cart row', async () => {
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
  expect(body.data[F.SUBTOTAL_LABEL]).toBe('Zwischensumme: €10.00');
  expect(body.data[F.TOTAL_LABEL]).toBe('Gesamt: €10.00');
  expect(body.data[F.DISCOUNT_VISIBLE]).toBe(false);
  expect(body.data[F.DELIVERY_VISIBLE]).toBe(false);
  expect(body.data[F.UI_PLACE_ORDER]).toBe('Bestellung aufgeben');
  expect(body.data[F.UI_REMOVE_LABEL]).toBe('Artikel entfernen:');
  expect(body.data[F.BASKET_ITEMS].some(i => i.id === 'clear')).toBe(false);
  const row = body.data[F.BASKET_ITEMS][0];
  expect(row).toMatchObject({
    id: '0',
    title: '1x Burger',
    metadata: '€10.00',
    image: 'img_0',
  });
  expect(attachListImages).toHaveBeenCalled();
  expect(attachListImages.mock.calls.at(-1)[1].flowListImageById['0']).toBe('thumb_b1');
});

test('ORDER_ITEM → CART_REVIEW shows localized discount line without banner', async () => {
  loadCheckoutTotals.mockResolvedValue({
    subtotal: 10,
    deliveryFee: 0,
    discount: 1.2,
    total: 8.8,
    isDelivery: false,
    deal: { label: '12% Rabatt', discountType: 'percent', discountValue: 12, discount: 1.2 },
  });
  mockSession([], { language: 'tr' });
  const res = await post({
    action: 'data_exchange',
    screen: S.ORDER_ITEM,
    version: V,
    flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: '1' },
  });
  const body = parsed(res);
  expect(body.data[F.DISCOUNT_VISIBLE]).toBe(true);
  expect(body.data[F.DISCOUNT_BANNER]).toBeUndefined();
  expect(body.data[F.SUBTOTAL_LABEL]).toBe('Ara toplam: €10.00');
  expect(body.data[F.DISCOUNT_LABEL]).toBe('12% indirim: −€1.20');
  expect(body.data[F.TOTAL_LABEL]).toBe('Toplam: €8.80');
  expect(body.data[F.DELIVERY_VISIBLE]).toBe(false);
  expect(body.data[F.UI_CART_HINT]).toBe('Çıkarmak için işaretleyin.');
});

test('ORDER_ITEM → CART_REVIEW shows delivery fee only when delivery', async () => {
  loadCheckoutTotals.mockResolvedValue({
    subtotal: 10,
    deliveryFee: 2.5,
    discount: 0,
    total: 12.5,
    isDelivery: true,
    deal: null,
  });
  mockSession([], { language: 'tr', orderType: 'delivery' });
  const res = await post({
    action: 'data_exchange',
    screen: S.ORDER_ITEM,
    version: V,
    flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: '1' },
  });
  const body = parsed(res);
  expect(body.data[F.DELIVERY_VISIBLE]).toBe(true);
  expect(body.data[F.DELIVERY_LABEL]).toBe('Teslimat ücreti: €2.50');
  expect(body.data[F.TOTAL_LABEL]).toBe('Toplam: €12.50');
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

test('checkout data_exchange on CHECKOUT_REVIEW without |checkout token still routes to checkout', async () => {
  getBusinessInfo.mockResolvedValue({
    name: 'Demo Kitchen',
    deliveryEnabled: true,
    deliveryOpen: true,
    deliveryFee: 2,
  });
  mockSession([{ name: 'Burger', qty: 1, price: 10 }], {
    businessId: 'biz1',
    language: 'en',
    customerName: 'Alex',
    orderType: 'delivery',
  });

  const res = await post({
    action: 'data_exchange',
    screen: S.CHECKOUT_REVIEW,
    version: V,
    flow_token: TOKEN,
    data: {
      checkout_action: 'select_order_type',
      [F.CUSTOMER_NAME]: 'Alex',
      [F.ORDER_TYPE]: 'pickup',
    },
  });

  expect(res.status).toBe(200);
  expect(parsed(res).screen).toBe(S.CHECKOUT_REVIEW);
  expect(parsed(res).data[F.ORDER_TYPE]).toBe('pickup');
  expect(parsed(res).data[F.ADDRESS_FIELDS_VISIBLE]).toBe(false);
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
  expect(body.data[F.MENU_ITEMS]).toHaveLength(3);
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
  expect(body.data[F.ITEM_DESCRIPTION]).toBe('Tasty');
  expect(body.data[F.ITEM_DESCRIPTION_VISIBLE]).toBe(true);
  expect(body.data[F.ITEM_PRICE]).toBe('€10.00');
  expect(body.data[F.UI_QTY_HELPER]).toBeTruthy();
  expect(body.data[F.FORM_INIT_VALUES]).toEqual({
    [F.QTY]: 1,
    [F.NOTES]: '',
    [F.MULTI_VALUE]: [],
    [F.SLOT1_VALUE]: '',
    [F.SLOT2_VALUE]: '',
    [F.SLOT3_VALUE]: '',
  });
  expect(body.data[F.ERROR_MESSAGES]).toEqual({});
  expect(body.data[F.UI_ORDER_FOOTER_ACTION]).toBe('add_item');
  expect(body.data[F.UI_ADD_TO_CART]).toBeTruthy();
  expect(body.data[F.SLOT1_VISIBLE]).toBe(false);
  expect(body.data[F.MULTI_VISIBLE]).toBe(false);
});

test('MENU_BROWSE → ORDER_ITEM keeps add footer when basket has items', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.UI_ORDER_FOOTER_ACTION]).toBe('add_item');
});

test('ORDER_ITEM back_to_cart returns CART_REVIEW without adding', async () => {
  const basket = [{ name: 'Burger', baseName: 'Burger', detail: '', itemId: 'b1', qty: 1, price: 10 }];
  const ref = mockSession(basket);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { cart_action: 'back_to_cart' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  expect(body.data[F.BASKET_ITEMS]).toHaveLength(1);
  // Clears any in-progress cart edit pointer; does not mutate basket.
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({ flowCartEditIndex: null }),
    expect.anything(),
  );
});

test('ORDER_ITEM back_to_cart with empty basket → category select', async () => {
  mockSession([]);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { cart_action: 'back_to_cart' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CATEGORY_SELECT_RETURN);
});

test('BACK from CART_REVIEW refreshes ORDER_ITEM with view-cart footer', async () => {
  mockSession(
    [{ name: 'Burger', baseName: 'Burger', detail: '', itemId: 'b1', qty: 1, price: 10 }],
    { flowLastOrderItemId: 'b1', flowLastOrderScreen: S.ORDER_ITEM },
  );
  const res = await post({
    action: 'BACK', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {},
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.ITEM_ID]).toBe('b1');
  expect(body.data[F.UI_ORDER_FOOTER_ACTION]).toBe('back_to_cart');
  expect(body.data[F.UI_ADD_TO_CART]).toMatch(/Warenkorb|cart|Sepete/i);
});

test('BACK from cart without last item → category select', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  const res = await post({
    action: 'BACK', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {},
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CATEGORY_SELECT_RETURN);
});

test('MENU_BROWSE → ORDER_ITEM hides description when missing', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'f1' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.ITEM_DESCRIPTION]).toBe('');
  expect(body.data[F.ITEM_DESCRIPTION_VISIBLE]).toBe(false);
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
  expect(saved.basket[0]).toMatchObject({
    name: 'Burger',
    baseName: 'Burger',
    detail: '',
    itemId: 'b1',
    qty: 2,
    price: 10,
  });
  expect(saved.flowLastOrderItemId).toBe('b1');
  expect(saved.flowLastOrderScreen).toBe(S.ORDER_ITEM);
});

test('ORDER_ITEM accepts ChipsSelector qty as one-element array', async () => {
  const ref = mockSession([]);
  await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: ['3'] },
  });
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket[0].qty).toBe(3);
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
  expect(saved.basket[0]).toMatchObject({
    itemId: 'p1',
    baseName: 'Pizza',
    notes: 'extra crispy',
    price: 17.5,
  });
  expect(saved.basket[0].detail).toContain('Large');
  expect(saved.basket[0].detail).not.toContain('extra crispy');
});

test('ORDER_ITEM → CART_REVIEW row uses baseName, detail, metadata, image', async () => {
  mockSession([]);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: {
      [F.ITEM_ID]: 'p1',
      [F.QTY]: '1',
      [F.SLOT1_VALUE]: 'l',
      [F.MULTI_VALUE]: ['cheese'],
    },
  });
  const body = parsed(res);
  const row = body.data[F.BASKET_ITEMS][0];
  expect(row.title).toBe('1x Pizza');
  expect(row.description).toContain('Large');
  expect(row.metadata).toBe('€17.50');
  expect(row.image).toBe('img_0');
  expect(attachListImages.mock.calls[0][1].flowListImageById).toEqual({});
});

test('ORDER_ITEM shows priced extras in option titles', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'p1' },
  });
  const body = parsed(res);
  expect(body.data[F.MULTI_OPTIONS][0].title).toContain('+€2.50');
});

test('ORDER_ITEM rejects qty over 10 with field error', async () => {
  mockSession([]);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: {
      [F.ITEM_ID]: 'b1',
      [F.QTY]: '11',
      [F.NOTES]: 'keep me',
      [F.MULTI_VALUE]: ['x'],
      [F.SLOT1_VALUE]: 's1',
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.ERROR_MESSAGES][F.QTY]).toBeTruthy();
  expect(body.data[F.FORM_INIT_VALUES]).toEqual({
    [F.QTY]: 11,
    [F.NOTES]: 'keep me',
    [F.MULTI_VALUE]: ['x'],
    [F.SLOT1_VALUE]: 's1',
    [F.SLOT2_VALUE]: '',
    [F.SLOT3_VALUE]: '',
  });
});

test('ORDER_ITEM rejects invalid qty with field error', async () => {
  mockSession([]);
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: 'abc' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.ERROR_MESSAGES][F.QTY]).toBeTruthy();
});

test('MENU_BROWSE → ORDER_ITEM applies multiDefault all and clears notes/slots', async () => {
  // multiDefault all → checkboxes preselected; notes/slots still reset for a fresh item.
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'p1' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.FORM_INIT_VALUES][F.NOTES]).toBe('');
  expect(body.data[F.FORM_INIT_VALUES][F.MULTI_VALUE]).toEqual(['cheese']);
  expect(body.data[F.FORM_INIT_VALUES][F.SLOT1_VALUE]).toBe('');
  expect(body.data[F.UI_MULTI_TOGGLE_VISIBLE]).toBe(true);
  expect(body.data[F.UI_MULTI_TOGGLE]).toBe('Alle abwählen');
});

test('MENU_BROWSE → ORDER_ITEM respects multiDefault none', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.MENU_BROWSE, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'p2' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.FORM_INIT_VALUES][F.MULTI_VALUE]).toEqual([]);
  expect(body.data[F.UI_MULTI_TOGGLE_VISIBLE]).toBe(true);
  expect(body.data[F.UI_MULTI_TOGGLE]).toBe('Alle wählen');
});

test('ORDER_ITEM multi toggle clears all when all selected', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: {
      multi_action: 'toggle',
      [F.UI_ORDER_FOOTER_ACTION]: 'add_item',
      [F.ITEM_ID]: 'p1',
      [F.QTY]: '2',
      [F.SLOT1_VALUE]: 'l',
      [F.MULTI_VALUE]: ['cheese'],
      [F.NOTES]: 'keep me',
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.FORM_INIT_VALUES][F.MULTI_VALUE]).toEqual([]);
  expect(body.data[F.FORM_INIT_VALUES][F.QTY]).toBe(2);
  expect(body.data[F.FORM_INIT_VALUES][F.SLOT1_VALUE]).toBe('l');
  expect(body.data[F.FORM_INIT_VALUES][F.NOTES]).toBe('keep me');
  expect(body.data[F.UI_MULTI_TOGGLE]).toBe('Alle wählen');
  expect(body.data[F.UI_ORDER_FOOTER_ACTION]).toBe('add_item');
});

test('ORDER_ITEM multi toggle selects all when partial/empty', async () => {
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM, version: V, flow_token: TOKEN,
    data: {
      multi_action: 'toggle',
      [F.UI_ORDER_FOOTER_ACTION]: 'add_item',
      [F.ITEM_ID]: 'p2',
      [F.QTY]: '1',
      [F.MULTI_VALUE]: [],
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM);
  expect(body.data[F.FORM_INIT_VALUES][F.MULTI_VALUE]).toEqual(['onion', 'olive']);
  expect(body.data[F.UI_MULTI_TOGGLE]).toBe('Alle abwählen');
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

test('CART_REVIEW does not duplicate notes when detail and notes match', async () => {
  mockSession([{
    name: 'Lahmacun (1 Stueck) (acili)',
    baseName: 'Lahmacun (1 Stueck)',
    detail: 'acili',
    notes: 'acili',
    qty: 1,
    price: 6.5,
    itemId: 'lah1',
  }]);
  getMenu.mockResolvedValue([
    { id: 'lah1', name: 'Lahmacun (1 Stueck)', price: 6.5, category: 'mains' },
  ]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: [], [F.REMOVE_MODE]: 'one' },
  });
  expect(parsed(res).data[F.BASKET_ITEMS][0].description).toBe('acili');
});

test('CART_REVIEW keeps menu SKU "(1 Stueck)" in title, not as notes detail', async () => {
  mockSession([{ name: 'Lahmacun (1 Stueck)', qty: 1, price: 6.5, menuItemId: 'lah1' }]);
  getMenu.mockResolvedValue([
    { id: 'lah1', name: 'Lahmacun (1 Stueck)', price: 6.5, category: 'mains', flowListImage: 'thumb_lah' },
  ]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: [], [F.REMOVE_MODE]: 'one' },
  });
  const row = parsed(res).data[F.BASKET_ITEMS][0];
  expect(row.title).toBe('1x Lahmacun (1 Stueck)');
  expect(row.description || '').not.toMatch(/Stueck|Stück/i);
});

test('CART_REVIEW edit does not prefill notes from SKU "(1 Stueck)"', async () => {
  mockSession([{
    name: 'Lahmacun (1 Stueck)', qty: 1, price: 6.5, menuItemId: 'lah1',
  }]);
  getMenu.mockResolvedValue([
    { id: 'lah1', name: 'Lahmacun (1 Stueck)', price: 6.5, category: 'mains', description: 'Mit Salat' },
  ]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: ['0'],
      [F.REMOVE_MODE]: 'edit',
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM_EDIT);
  expect(body.data[F.FORM_INIT_VALUES][F.NOTES]).toBe('');
});

test('CART_REVIEW resolves thumbs from menuItemId (chat/intent lines)', async () => {
  mockSession([
    { name: 'Burger', qty: 1, price: 10, menuItemId: 'b1' },
  ]);
  getMenu.mockResolvedValue([
    { id: 'b1', name: 'Burger', price: 10, category: 'mains', flowListImage: 'thumb_b1' },
  ]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: [], [F.REMOVE_MODE]: 'one' },
  });
  expect(parsed(res).screen).toBe(S.CART_REVIEW);
  expect(attachListImages.mock.calls.at(-1)[1].flowListImageById['0']).toBe('thumb_b1');
});

test('CART_REVIEW resolves thumbs by exact name when no ids', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  getMenu.mockResolvedValue([
    { id: 'b1', name: 'Burger', price: 10, category: 'mains', flowListImage: 'thumb_b1' },
  ]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: [], [F.REMOVE_MODE]: 'one' },
  });
  expect(attachListImages.mock.calls.at(-1)[1].flowListImageById['0']).toBe('thumb_b1');
});

test('CART_REVIEW remove_one by index → stay on CART_REVIEW with remaining lines', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_one', [F.REMOVE_ITEMS]: ['0'] },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  expect(body.data[F.BASKET_ITEMS]).toHaveLength(1);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(1);
  expect(saved.basket[0].name).toBe('Fries');
});

test('CART_REVIEW remove_items + mode one string id → decrement Fries qty', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: '1',
      [F.REMOVE_MODE]: 'one',
    },
  });
  expect(parsed(res).screen).toBe(S.CART_REVIEW);
  expect(parsed(res).data[F.BASKET_ITEMS]).toHaveLength(2);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(2);
  expect(saved.basket[1]).toMatchObject({ name: 'Fries', qty: 1 });
});

test('CART_REVIEW remove_items mode one on multi-qty → decrement by 1', async () => {
  const ref = mockSession([{ name: 'Lahmacun', qty: 3, price: 6.5 }]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: ['0'],
      [F.REMOVE_MODE]: 'one',
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  expect(body.data[F.BASKET_ITEMS]).toHaveLength(1);
  expect(body.data[F.BASKET_ITEMS][0].title).toMatch(/^2x /);
  expect(body.data[F.REMOVE_MODE_OPTIONS]).toHaveLength(4);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toEqual([{ name: 'Lahmacun', qty: 2, price: 6.5 }]);
});

test('CART_REVIEW remove_items mode all clears basket without selection', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: [],
      [F.REMOVE_MODE]: 'all',
    },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(0);
});

test('CART_REVIEW remove_items mode line drops whole multi-qty line', async () => {
  const ref = mockSession([{ name: 'Lahmacun', qty: 10, price: 6.5 }]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: ['0'],
      [F.REMOVE_MODE]: 'line',
    },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(0);
});

test('CART_REVIEW remove_items without mode defaults to line (legacy)', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: ['0'] },
  });
  expect(parsed(res).screen).toBe(S.CART_REVIEW);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toEqual([{ name: 'Fries', qty: 2, price: 5 }]);
});

test('CART_REVIEW remove_line clear → empty basket → CATEGORY_SELECT_RETURN', async () => {
  const ref = mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_line', [F.REMOVE_ITEMS]: ['clear'] },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.basket).toHaveLength(0);
});

test('CART_REVIEW remove_line makes basket empty → CATEGORY_SELECT_RETURN', async () => {
  mockSession([{ name: 'Burger', qty: 1, price: 10 }]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_line', [F.REMOVE_ITEMS]: ['0'] },
  });
  expect(parsed(res).screen).toBe(S.CATEGORY_SELECT_RETURN);
});

test('CART_REVIEW remove_items empty array → stay on CART_REVIEW', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_items', [F.REMOVE_ITEMS]: [], [F.REMOVE_MODE]: 'one' },
  });
  expect(parsed(res).screen).toBe(S.CART_REVIEW);
  expect(parsed(res).data[F.BASKET_ITEMS]).toHaveLength(2);
});

test('CART_UPDATED remove_one empty array → stay on CART_UPDATED', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_UPDATED, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_one', [F.REMOVE_ITEMS]: [] },
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

test('CART_UPDATED remove_one → stay on CART_UPDATED with remaining lines', async () => {
  mockSession(BASKET2);
  const res = await post({
    action: 'data_exchange', screen: S.CART_UPDATED, version: V, flow_token: TOKEN,
    data: { cart_action: 'remove_one', [F.REMOVE_ITEMS]: ['0'] },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_UPDATED);
  expect(body.data[F.BASKET_ITEMS]).toHaveLength(1);
});

test('CART_REVIEW edit mode needs exactly one selection', async () => {
  mockSession([
    { name: 'Burger', baseName: 'Burger', itemId: 'b1', qty: 1, price: 10 },
    { name: 'Fries', baseName: 'Fries', itemId: 'f1', qty: 1, price: 5 },
  ]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: [],
      [F.REMOVE_MODE]: 'edit',
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_REVIEW);
  expect(body.data[F.ERROR_VISIBLE]).toBe(true);
});

test('CART_REVIEW edit mode → ORDER_ITEM_EDIT with prefill', async () => {
  const ref = mockSession([{
    name: 'Pizza — Large (extra cheese)',
    baseName: 'Pizza',
    itemId: 'p1',
    qty: 2,
    price: 17.5,
    notes: 'extra cheese',
    flowSelections: { size: 'l', extras: ['cheese'] },
  }]);
  const res = await post({
    action: 'data_exchange', screen: S.CART_REVIEW, version: V, flow_token: TOKEN,
    data: {
      cart_action: 'remove_items',
      [F.REMOVE_ITEMS]: ['0'],
      [F.REMOVE_MODE]: 'edit',
    },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.ORDER_ITEM_EDIT);
  expect(body.data[F.ITEM_ID]).toBe('p1');
  expect(body.data[F.FORM_INIT_VALUES][F.QTY]).toBe(2);
  expect(body.data[F.FORM_INIT_VALUES][F.SLOT1_VALUE]).toBe('l');
  expect(body.data[F.FORM_INIT_VALUES][F.MULTI_VALUE]).toEqual(['cheese']);
  expect(body.data[F.FORM_INIT_VALUES][F.NOTES]).toBe('extra cheese');
  expect(body.data[F.UI_ORDER_FOOTER_ACTION]).toBe('add_item');
  expect(body.data[F.UI_ADD_TO_CART]).toBe('Speichern');
  expect(ref.set).toHaveBeenCalledWith(
    expect.objectContaining({ flowCartEditIndex: 0 }),
    expect.anything(),
  );
});

test('ORDER_ITEM_EDIT save replaces basket line', async () => {
  const ref = mockSession([
    {
      name: 'Burger', baseName: 'Burger', itemId: 'b1', qty: 1, price: 10,
      flowSelections: {},
    },
    { name: 'Fries', baseName: 'Fries', itemId: 'f1', qty: 1, price: 5 },
  ], { flowCartEditIndex: 0 });
  const res = await post({
    action: 'data_exchange', screen: S.ORDER_ITEM_EDIT, version: V, flow_token: TOKEN,
    data: { [F.ITEM_ID]: 'b1', [F.QTY]: '3', [F.NOTES]: 'no onion' },
  });
  const body = parsed(res);
  expect(body.screen).toBe(S.CART_EDITED);
  const [saved] = ref.set.mock.calls[0];
  expect(saved.flowCartEditIndex).toBeNull();
  expect(saved.basket).toHaveLength(2);
  expect(saved.basket[0]).toMatchObject({ itemId: 'b1', qty: 3, notes: 'no onion' });
  expect(saved.basket[1].name).toBe('Fries');
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
