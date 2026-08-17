jest.mock('../../lib/dashboardAuth', () => ({
  requireOwnerOrAdmin: (_req, _res, next) => next(),
  requireOwnerOfBusiness: (req, _res, next) => {
    req.uid = 'owner-uid';
    next();
  },
}));

jest.mock('../../lib/dealService', () => {
  const actual = jest.requireActual('../../lib/dealService');
  return {
    ...actual,
    listDeals: jest.fn(),
    upsertDeal: jest.fn(),
    setDealActive: jest.fn(),
    endDeal: jest.fn(),
  };
});

const request = require('supertest');
const app = require('../../index');
const {
  listDeals,
  upsertDeal,
  setDealActive,
  endDeal,
} = require('../../lib/dealService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('deals routes', () => {
  test('GET /api/businesses/:businessId/deals returns listDeals', async () => {
    const payload = { firstOrder: null, window: null, history: [] };
    listDeals.mockResolvedValue(payload);

    const res = await request(app).get('/api/businesses/biz1/deals');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
    expect(listDeals).toHaveBeenCalledWith('biz1');
  });

  test('PUT window without dates → 400', async () => {
    const res = await request(app)
      .put('/api/businesses/biz1/deals/window')
      .send({ discountType: 'percent', discountValue: 10 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'window deal requires startsAt and endsAt' });
    expect(upsertDeal).not.toHaveBeenCalled();
  });

  test('PUT percent 0 → 400', async () => {
    const res = await request(app)
      .put('/api/businesses/biz1/deals/first-order')
      .send({ discountType: 'percent', discountValue: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'percent discountValue must be > 0 and <= 100' });
    expect(upsertDeal).not.toHaveBeenCalled();
  });

  test('PUT happy path calls upsertDeal with uid from req.uid', async () => {
    const list = {
      firstOrder: {
        dealId: 'd1',
        kind: 'first_order',
        discountType: 'percent',
        discountValue: 10,
        label: '10% Rabatt',
        active: true,
      },
      window: null,
      history: [],
    };
    upsertDeal.mockResolvedValue(list);
    const body = { discountType: 'percent', discountValue: 10 };

    const res = await request(app)
      .put('/api/businesses/biz1/deals/first-order')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(list);
    expect(upsertDeal).toHaveBeenCalledWith({
      businessId: 'biz1',
      kindParam: 'first-order',
      body,
      uid: 'owner-uid',
    });
  });

  test('PUT window happy path uses kindParam window', async () => {
    const list = { firstOrder: null, window: { dealId: 'w1', kind: 'window', active: true }, history: [] };
    upsertDeal.mockResolvedValue(list);
    const body = {
      discountType: 'percent',
      discountValue: 15,
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-08-31T23:59:59.000Z',
    };

    const res = await request(app)
      .put('/api/businesses/biz1/deals/window')
      .send(body);

    expect(res.status).toBe(200);
    expect(upsertDeal).toHaveBeenCalledWith({
      businessId: 'biz1',
      kindParam: 'window',
      body,
      uid: 'owner-uid',
    });
  });

  test('POST pause calls setDealActive with active and uid', async () => {
    const list = { firstOrder: null, window: { dealId: 'd1', active: false }, history: [] };
    setDealActive.mockResolvedValue(list);

    const res = await request(app)
      .post('/api/businesses/biz1/deals/window/pause')
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(list);
    expect(setDealActive).toHaveBeenCalledWith({
      businessId: 'biz1',
      kindParam: 'window',
      active: false,
      uid: 'owner-uid',
    });
  });

  test('POST end calls endDeal with uid', async () => {
    const list = { firstOrder: null, window: null, history: [] };
    endDeal.mockResolvedValue(list);

    const res = await request(app)
      .post('/api/businesses/biz1/deals/first-order/end');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(list);
    expect(endDeal).toHaveBeenCalledWith({
      businessId: 'biz1',
      kindParam: 'first-order',
      uid: 'owner-uid',
    });
  });

  test('maps thrown { status, message } to JSON error', async () => {
    upsertDeal.mockRejectedValue({ status: 404, message: 'Business not found' });

    const res = await request(app)
      .put('/api/businesses/biz1/deals/first-order')
      .send({ discountType: 'percent', discountValue: 10 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Business not found' });
  });

  test('unexpected PUT error → 500 Failed to save deal', async () => {
    upsertDeal.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .put('/api/businesses/biz1/deals/first-order')
      .send({ discountType: 'percent', discountValue: 10 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save deal' });
  });

  test('unexpected GET error → 500 Failed to load deals', async () => {
    listDeals.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/businesses/biz1/deals');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to load deals' });
  });

  test('unexpected pause error → 500 Failed to pause deal', async () => {
    setDealActive.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/businesses/biz1/deals/window/pause')
      .send({ active: false });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to pause deal' });
  });

  test('unexpected end error → 500 Failed to end deal', async () => {
    endDeal.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/businesses/biz1/deals/first-order/end');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to end deal' });
  });
});
