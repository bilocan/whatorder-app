jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/collections', () => ({
  businessRef: jest.fn(),
  phoneRoutingRef: jest.fn(),
}));
jest.mock('../../bot/sessionStore', () => ({
  getSession: jest.fn(),
  patchSession: jest.fn(),
}));
jest.mock('../../bot/menuService', () => ({
  getMenu: jest.fn(),
}));

const request = require('supertest');
const app = require('../../index');
const { businessRef, phoneRoutingRef } = require('../../lib/collections');
const { getSession, patchSession } = require('../../bot/sessionStore');
const { getMenu } = require('../../bot/menuService');

const MENU = [
  { id: '1', name: 'Döner', price: 8.5, aliases: ['doner'] },
];

function setupBusiness() {
  businessRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ name: 'Döner Palace' }),
    }),
  });

  phoneRoutingRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({ displayNumber: '+43 660 1234567' }),
    }),
  });
}

describe('GET /api/keypad/:businessId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'pn_123';
    setupBusiness();
  });

  test('returns keypad config', async () => {
    const res = await request(app).get('/api/keypad/biz1?lang=en');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      businessId: 'biz1',
      name: 'Döner Palace',
      whatsappNumber: '436601234567',
      lang: 'en',
    });
    expect(res.body.context).toBeNull();
  });

  test('404 when business missing', async () => {
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
    });
    const res = await request(app).get('/api/keypad/missing');
    expect(res.status).toBe(404);
  });

  test('includes session context when customer phone provided', async () => {
    getSession.mockResolvedValue({
      state: 'browsing',
      businessId: 'biz1',
      basket: [{ name: 'Ayran', qty: 2, price: 2.5 }],
    });
    const res = await request(app).get('/api/keypad/biz1?customer=436601111111&lang=de');
    expect(res.status).toBe(200);
    expect(res.body.context.phase).toBe('has_basket');
    expect(res.body.context.basketCount).toBe(1);
    expect(res.body.context.basket[0].name).toBe('Ayran');
    expect(res.body.context.actions.some((a) => a.id === 'checkout')).toBe(true);
  });
});

describe('POST /api/keypad/:businessId/apply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'pn_123';
    setupBusiness();
    getMenu.mockResolvedValue(MENU);
  });

  test('requires customer phone', async () => {
    const res = await request(app)
      .post('/api/keypad/biz1/apply')
      .send({ action: 'add', text: 'döner' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('customer_required');
  });

  test('add merges item into session basket', async () => {
    let session = { state: 'browsing', basket: [] };
    getSession.mockImplementation(async () => session);
    patchSession.mockImplementation(async (_phone, patch) => {
      session = { ...session, ...patch };
    });

    const res = await request(app)
      .post('/api/keypad/biz1/apply')
      .send({
        customer: '436601111111',
        lang: 'en',
        action: 'add',
        text: 'döner',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.context.basketCount).toBe(1);
    expect(patchSession).toHaveBeenCalled();
  });

  test('checkout returns openWhatsApp hint', async () => {
    getSession.mockResolvedValue({
      state: 'browsing',
      basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
    });

    const res = await request(app)
      .post('/api/keypad/biz1/apply')
      .send({
        customer: '436601111111',
        action: 'checkout',
      });

    expect(res.status).toBe(200);
    expect(res.body.openWhatsApp).toBe(true);
    expect(res.body.waText).toBe('checkout');
  });
});
