jest.mock('../firebase', () => {
  class Timestamp {
    constructor(date) {
      this._date = date instanceof Date ? date : new Date(date);
      this.seconds = Math.floor(this._date.getTime() / 1000);
      this.nanoseconds = (this._date.getTime() % 1000) * 1e6;
    }

    toDate() {
      return new Date(this._date);
    }

    toMillis() {
      return this._date.getTime();
    }

    static fromDate(d) {
      return new Timestamp(d);
    }

    static fromMillis(ms) {
      return new Timestamp(ms);
    }

    static now() {
      return new Timestamp(new Date());
    }
  }

  return {
    admin: { firestore: { Timestamp } },
    db: { runTransaction: jest.fn() },
  };
});

jest.mock('../collections', () => ({
  businessRef: jest.fn(),
  dealsRef: jest.fn(),
  dealRef: jest.fn(),
}));

const crypto = require('crypto');
const { db, admin } = require('../firebase');
const { businessRef, dealsRef, dealRef } = require('../collections');
const {
  parseDealKindParam,
  validateDealBody,
  listDeals,
  upsertDeal,
  setDealActive,
  endDeal,
} = require('../dealService');

const NOW = new Date('2026-08-13T12:00:00.000Z');
const START = '2026-08-01T00:00:00.000Z';
const END = '2026-08-31T23:59:59.000Z';

function expectHttpError(err, status) {
  expect(err).toEqual(expect.objectContaining({ status, message: expect.any(String) }));
}

function mockHarness({ exists = true, deals = {}, history = {} } = {}) {
  const biz = { deals: { ...deals } };
  const hist = { ...history };
  const writes = [];

  businessRef.mockImplementation((bid) => ({
    id: bid,
    kind: 'business',
    path: `businesses/${bid}`,
    get: jest.fn(async () => ({
      exists,
      data: () => ({ deals: { ...biz.deals } }),
    })),
  }));

  dealRef.mockImplementation((bid, dealId) => ({
    id: dealId,
    businessId: bid,
    kind: 'deal',
    path: `businesses/${bid}/deals/${dealId}`,
  }));

  dealsRef.mockImplementation(() => ({
    orderBy: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: jest.fn(async () => ({
          docs: Object.entries(hist).map(([id, data]) => ({
            id,
            data: () => ({ ...data }),
          })),
        })),
      })),
    })),
  }));

  db.runTransaction.mockImplementation(async (fn) => {
    const tx = {
      get: async (ref) => {
        if (ref.kind === 'business') {
          return {
            exists,
            data: () => ({ deals: { ...biz.deals } }),
          };
        }
        return {
          exists: Object.prototype.hasOwnProperty.call(hist, ref.id),
          data: () => ({ ...hist[ref.id] }),
        };
      },
      set: (ref, data) => {
        writes.push({ op: 'set', kind: ref.kind, id: ref.id, data: { ...data } });
        if (ref.kind === 'deal') hist[ref.id] = { ...data };
      },
      update: (ref, data) => {
        writes.push({ op: 'update', kind: ref.kind, id: ref.id, data: { ...data } });
        if (ref.kind === 'business') {
          if (Object.prototype.hasOwnProperty.call(data, 'deals')) {
            biz.deals = { ...data.deals };
          }
        } else if (ref.kind === 'deal') {
          hist[ref.id] = { ...(hist[ref.id] || {}), ...data };
        }
      },
    };
    return fn(tx);
  });

  return { biz, hist, writes };
}

describe('parseDealKindParam', () => {
  test("maps first-order to { slotKey: 'firstOrder', kind: 'first_order' }", () => {
    expect(parseDealKindParam('first-order')).toEqual({
      slotKey: 'firstOrder',
      kind: 'first_order',
    });
  });

  test("maps window to { slotKey: 'window', kind: 'window' }", () => {
    expect(parseDealKindParam('window')).toEqual({
      slotKey: 'window',
      kind: 'window',
    });
  });

  test('returns null for unknown kind', () => {
    expect(parseDealKindParam('lunch')).toBeNull();
    expect(parseDealKindParam('first_order')).toBeNull();
  });
});

describe('validateDealBody', () => {
  test('uses defaultDealLabel when label is omitted', () => {
    const result = validateDealBody('first_order', {
      discountType: 'percent',
      discountValue: 10,
    });
    expect(result.label).toBe('10% Rabatt');
  });

  test('uses defaultDealLabel when label is blank', () => {
    const result = validateDealBody('first_order', {
      discountType: 'fixed',
      discountValue: 2,
      label: '  ',
    });
    expect(result.label).toBe('€2.00 Rabatt');
  });

  test('trims a custom label', () => {
    const result = validateDealBody('first_order', {
      discountType: 'percent',
      discountValue: 10,
      label: '  10% Willkommen  ',
    });
    expect(result.label).toBe('10% Willkommen');
  });

  test('rejects window missing dates with 400', () => {
    try {
      validateDealBody('window', { discountType: 'percent', discountValue: 10 });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.message).not.toBe('expected throw');
      expectHttpError(err, 400);
    }
  });

  test('rejects percent 10.55 (more than one decimal)', () => {
    try {
      validateDealBody('first_order', { discountType: 'percent', discountValue: 10.55 });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.message).not.toBe('expected throw');
      expectHttpError(err, 400);
    }
  });

  test('allows percent 10.5', () => {
    const result = validateDealBody('first_order', {
      discountType: 'percent',
      discountValue: 10.5,
    });
    expect(result.discountValue).toBe(10.5);
  });

  test('allows first-order without dates', () => {
    const result = validateDealBody('first_order', {
      discountType: 'percent',
      discountValue: 10,
    });
    expect(result.startsAt).toBeNull();
    expect(result.endsAt).toBeNull();
  });

  test('rejects first-order when only one date is set', () => {
    try {
      validateDealBody('first_order', {
        discountType: 'percent',
        discountValue: 10,
        startsAt: START,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.message).not.toBe('expected throw');
      expectHttpError(err, 400);
    }
  });
});

describe('upsertDeal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(crypto, 'randomUUID').mockReturnValue('new-deal-id');
  });

  afterEach(() => {
    crypto.randomUUID.mockRestore();
  });

  test('throws 404 when business is missing', async () => {
    mockHarness({ exists: false });
    try {
      await upsertDeal({
        businessId: 'biz1',
        kindParam: 'first-order',
        body: { discountType: 'percent', discountValue: 10 },
        uid: 'owner1',
        now: NOW,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.message).not.toBe('expected throw');
      expect(err).toEqual({ status: 404, message: 'Business not found' });
    }
  });

  test('ends previous history and writes a new live slot', async () => {
    const prevSlot = {
      dealId: 'old-deal-id',
      kind: 'first_order',
      discountType: 'percent',
      discountValue: 5,
      label: '5% Rabatt',
      startsAt: null,
      endsAt: null,
      active: true,
    };
    const { biz, hist, writes } = mockHarness({
      deals: { firstOrder: prevSlot, window: { dealId: 'win-keep' } },
      history: {
        'old-deal-id': { ...prevSlot, status: 'active', createdBy: 'prev' },
      },
    });

    const result = await upsertDeal({
      businessId: 'biz1',
      kindParam: 'first-order',
      body: { discountType: 'percent', discountValue: 10 },
      uid: 'owner1',
      now: NOW,
    });

    expect(result.firstOrder).toEqual(expect.objectContaining({
      dealId: 'new-deal-id',
      kind: 'first_order',
      discountType: 'percent',
      discountValue: 10,
      label: '10% Rabatt',
      active: true,
      updatedAt: NOW.toISOString(),
    }));
    expect(result.window).toEqual(expect.objectContaining({ dealId: 'win-keep' }));
    expect(Array.isArray(result.history)).toBe(true);
    expect(result.history.some((h) => h.dealId === 'new-deal-id' && h.status === 'active')).toBe(true);

    const endWrite = writes.find((w) => w.op === 'update' && w.id === 'old-deal-id');
    expect(endWrite.data.status).toBe('ended');
    expect(endWrite.data.endedAt.toMillis()).toBe(NOW.getTime());

    const newHist = hist['new-deal-id'];
    expect(newHist.status).toBe('active');
    expect(newHist.createdBy).toBe('owner1');
    expect(newHist.label).toBe('10% Rabatt');
    expect(newHist.kind).toBe('first_order');
    expect(newHist.active).toBe(true);
    expect(newHist).toHaveProperty('createdAt');

    const live = biz.deals.firstOrder;
    expect(live.dealId).toBe('new-deal-id');
    expect(live.active).toBe(true);
    expect(live.label).toBe('10% Rabatt');
    expect(live).not.toHaveProperty('status');
    expect(live).not.toHaveProperty('createdAt');
    expect(live).not.toHaveProperty('createdBy');
    expect(biz.deals.window).toEqual({ dealId: 'win-keep' });
  });
});

describe('setDealActive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('pause sets live active false and history status paused', async () => {
    const slot = {
      dealId: 'fo1',
      kind: 'first_order',
      discountType: 'percent',
      discountValue: 10,
      label: '10% Rabatt',
      active: true,
    };
    const { biz, hist } = mockHarness({
      deals: { firstOrder: slot },
      history: { fo1: { ...slot, status: 'active' } },
    });

    const result = await setDealActive({
      businessId: 'biz1',
      kindParam: 'first-order',
      active: false,
      uid: 'owner1',
      now: NOW,
    });

    expect(result.firstOrder.active).toBe(false);
    expect(result.history.find((h) => h.dealId === 'fo1').status).toBe('paused');
    expect(biz.deals.firstOrder.active).toBe(false);
    expect(hist.fo1.status).toBe('paused');
    expect(hist.fo1.active).toBe(false);
  });

  test('throws 404 when there is no live deal', async () => {
    mockHarness({ deals: { firstOrder: null } });
    try {
      await setDealActive({
        businessId: 'biz1',
        kindParam: 'first-order',
        active: false,
        uid: 'owner1',
        now: NOW,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.message).not.toBe('expected throw');
      expect(err).toEqual({ status: 404, message: 'No live deal' });
    }
  });
});

describe('endDeal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('clears the live slot and keeps the other kind', async () => {
    const fo = {
      dealId: 'fo1',
      kind: 'first_order',
      discountType: 'percent',
      discountValue: 10,
      label: '10% Rabatt',
      active: true,
    };
    const win = {
      dealId: 'w1',
      kind: 'window',
      discountType: 'percent',
      discountValue: 15,
      label: '15% Rabatt',
      active: true,
    };
    const { biz, hist } = mockHarness({
      deals: { firstOrder: fo, window: win },
      history: { fo1: { ...fo, status: 'active' } },
    });

    const result = await endDeal({
      businessId: 'biz1',
      kindParam: 'first-order',
      uid: 'owner1',
      now: NOW,
    });

    expect(result.firstOrder).toBeNull();
    expect(result.window).toEqual(expect.objectContaining({ dealId: 'w1' }));
    expect(result.history.find((h) => h.dealId === 'fo1').status).toBe('ended');
    expect(biz.deals.firstOrder).toBeNull();
    expect(biz.deals.window).toEqual(win);
    expect(hist.fo1.status).toBe('ended');
    expect(hist.fo1.endedAt.toMillis()).toBe(NOW.getTime());
  });
});

describe('listDeals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('serializes timestamps to ISO and returns history', async () => {
    const ts = admin.firestore.Timestamp.fromDate(NOW);
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          deals: {
            firstOrder: {
              dealId: 'fo1',
              kind: 'first_order',
              startsAt: null,
              endsAt: null,
              updatedAt: ts,
              active: true,
            },
            window: null,
          },
        }),
      }),
    });
    const orderBy = jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn() })) }));
    const limit = jest.fn(() => ({ get: jest.fn() }));
    const get = jest.fn().mockResolvedValue({
      docs: [{
        id: 'fo1',
        data: () => ({
          dealId: 'fo1',
          kind: 'first_order',
          status: 'active',
          createdAt: ts,
          endedAt: null,
          createdBy: 'owner1',
        }),
      }],
    });
    orderBy.mockReturnValue({ limit });
    limit.mockReturnValue({ get });
    dealsRef.mockReturnValue({ orderBy });

    const result = await listDeals('biz1');

    expect(dealsRef).toHaveBeenCalledWith('biz1');
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(limit).toHaveBeenCalledWith(20);
    expect(result.firstOrder.updatedAt).toBe(NOW.toISOString());
    expect(result.firstOrder.startsAt).toBeNull();
    expect(result.window).toBeNull();
    expect(result.history).toHaveLength(1);
    expect(result.history[0].createdAt).toBe(NOW.toISOString());
    expect(result.history[0].endedAt).toBeNull();
  });
});
