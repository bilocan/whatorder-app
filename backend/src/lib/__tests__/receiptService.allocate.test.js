jest.mock('../firebase', () => {
  const FieldValue = {
    serverTimestamp: jest.fn(() => 'TS'),
    delete: jest.fn(() => 'DELETE'),
  };
  const runTransaction = jest.fn();
  return {
    admin: { firestore: { FieldValue } },
    db: { runTransaction },
  };
});

jest.mock('../collections', () => ({
  businessRef: jest.fn(),
  ordersRef: jest.fn(),
  receiptRef: jest.fn(),
  receiptCounterRef: jest.fn(),
}));

jest.mock('../receipts/customerBelegPdf', () => ({
  renderCustomerBelegPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-mock')),
}));

jest.mock('../receipts/gcsReceiptStorage', () => ({
  uploadReceiptPdf: jest.fn().mockResolvedValue('businesses/biz1/receipts/2026/WO-2026-000001.pdf'),
  downloadReceiptPdf: jest.fn(),
  getReceiptSignedUrl: jest.fn(),
}));

const { db } = require('../firebase');
const { receiptRef, receiptCounterRef, ordersRef, businessRef } = require('../collections');
const { allocateReceiptSlot, issueCustomerBeleg } = require('../receiptService');
const { uploadReceiptPdf } = require('../receipts/gcsReceiptStorage');

const year = new Date().getFullYear();

function belegPayload(overrides = {}) {
  return {
    businessId: 'biz1',
    orderId: 'ord1',
    paymentRef: 'cs_1',
    sellerSnapshot: { legalName: 'A' },
    buyerSnapshot: { name: 'B' },
    lines: [],
    totalsByVat: { '10': { net: 1, vat: 0.1, gross: 1.1 } },
    totalGross: 1.1,
    ...overrides,
  };
}

/**
 * In-memory txn harness keyed by businessId so counters/receipts stay isolated.
 * @param {{ initialCounters?: Record<string, { nextNumber?: number } | null> }} [opts]
 *   Pass `null` for a business to simulate a missing counter doc.
 */
function mockAllocateHarness(opts = {}) {
  const { initialCounters = { biz1: { nextNumber: 1 } } } = opts;
  const counters = new Map();
  const stores = new Map();

  for (const [bid, data] of Object.entries(initialCounters)) {
    if (data !== null) counters.set(bid, { ...data });
    stores.set(bid, new Map());
  }

  receiptRef.mockImplementation((bid, id) => ({
    id,
    businessId: bid,
    path: `businesses/${bid}/receipts/${id}`,
    kind: 'receipt',
  }));
  receiptCounterRef.mockImplementation((bid) => ({
    businessId: bid,
    path: `businesses/${bid}/counters/receipts`,
    kind: 'counter',
  }));

  db.runTransaction.mockImplementation(async (fn) => {
    const tx = {
      get: async (ref) => {
        const bid = ref.businessId;
        if (ref.kind === 'counter') {
          if (!counters.has(bid)) {
            return { exists: false, data: () => ({}) };
          }
          return {
            exists: true,
            data: () => ({ ...counters.get(bid) }),
          };
        }
        const store = stores.get(bid) || new Map();
        if (store.has(ref.id)) {
          return { exists: true, data: () => store.get(ref.id) };
        }
        return { exists: false };
      },
      set: (ref, data) => {
        const bid = ref.businessId;
        if (ref.kind === 'counter') {
          const prev = counters.get(bid) || {};
          counters.set(bid, { ...prev, ...data });
          return;
        }
        if (!stores.has(bid)) stores.set(bid, new Map());
        stores.get(bid).set(ref.id, { ...data });
      },
    };
    return fn(tx);
  });

  return { counters, stores };
}

describe('allocateReceiptSlot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates new beleg number and is idempotent for same paymentRef', async () => {
    const { counters } = mockAllocateHarness();

    const payload = belegPayload();
    const first = await allocateReceiptSlot(payload);
    expect(first.created).toBe(true);
    expect(first.belegNumber).toBe(`WO-${year}-000001`);
    expect(counters.get('biz1').nextNumber).toBe(2);

    const second = await allocateReceiptSlot(payload);
    expect(second.created).toBe(false);
    expect(second.belegNumber).toBe(first.belegNumber);
    expect(counters.get('biz1').nextNumber).toBe(2);
  });

  test('freezes discount and discountLabel on the receipt doc', async () => {
    mockAllocateHarness();
    const result = await allocateReceiptSlot(belegPayload({
      discount: 2,
      discountLabel: '10% Willkommen',
      lines: [{ name: 'Döner', gross: 10 }, { name: '10% Willkommen', kind: 'discount', gross: -2 }],
    }));
    expect(result.discount).toBe(2);
    expect(result.discountLabel).toBe('10% Willkommen');
  });

  test('stores discount 0 and null label when omitted', async () => {
    mockAllocateHarness();
    const result = await allocateReceiptSlot(belegPayload());
    expect(result.discount).toBe(0);
    expect(result.discountLabel).toBeNull();
  });

  test('increments sequence for distinct paymentRefs on the same business', async () => {
    const { counters } = mockAllocateHarness();

    const a = await allocateReceiptSlot(belegPayload({ paymentRef: 'cs_a', orderId: 'ord_a' }));
    const b = await allocateReceiptSlot(belegPayload({ paymentRef: 'cs_b', orderId: 'ord_b' }));

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.belegNumber).toBe(`WO-${year}-000001`);
    expect(b.belegNumber).toBe(`WO-${year}-000002`);
    expect(counters.get('biz1').nextNumber).toBe(3);
  });

  test('isolates counters across restaurants (same printed number is OK)', async () => {
    const { counters } = mockAllocateHarness({
      initialCounters: {
        biz_enes: { nextNumber: 1 },
        biz_other: { nextNumber: 1 },
      },
    });

    const enes = await allocateReceiptSlot(belegPayload({
      businessId: 'biz_enes',
      paymentRef: 'cs_enes_1',
      orderId: 'ord_enes',
    }));
    const other = await allocateReceiptSlot(belegPayload({
      businessId: 'biz_other',
      paymentRef: 'cs_other_1',
      orderId: 'ord_other',
    }));

    expect(enes.belegNumber).toBe(`WO-${year}-000001`);
    expect(other.belegNumber).toBe(`WO-${year}-000001`);
    expect(enes.belegNumber).toBe(other.belegNumber);
    expect(counters.get('biz_enes').nextNumber).toBe(2);
    expect(counters.get('biz_other').nextNumber).toBe(2);

    const enes2 = await allocateReceiptSlot(belegPayload({
      businessId: 'biz_enes',
      paymentRef: 'cs_enes_2',
      orderId: 'ord_enes_2',
    }));
    expect(enes2.belegNumber).toBe(`WO-${year}-000002`);
    expect(counters.get('biz_other').nextNumber).toBe(2);
  });

  test('starts at 000001 when counter doc is missing', async () => {
    const { counters } = mockAllocateHarness({
      initialCounters: { biz1: null },
    });

    const first = await allocateReceiptSlot(belegPayload({ paymentRef: 'cs_fresh' }));
    expect(first.created).toBe(true);
    expect(first.belegNumber).toBe(`WO-${year}-000001`);
    expect(counters.get('biz1').nextNumber).toBe(2);
  });

  test('starts at 000001 when counter exists but nextNumber is absent', async () => {
    const { counters } = mockAllocateHarness({
      initialCounters: { biz1: {} },
    });

    const first = await allocateReceiptSlot(belegPayload({ paymentRef: 'cs_empty_field' }));
    expect(first.belegNumber).toBe(`WO-${year}-000001`);
    expect(counters.get('biz1').nextNumber).toBe(2);
  });
});

describe('issueCustomerBeleg', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('marks failed when order lacks tax snapshot', async () => {
    const set = jest.fn().mockResolvedValue();
    receiptRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: false }),
      set,
    });
    ordersRef.mockReturnValue({
      doc: () => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ items: [], customerName: 'A' }),
        }),
        update: jest.fn(),
      }),
    });
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Shop', legal: { legalName: 'L' } }),
      }),
    });

    const result = await issueCustomerBeleg('biz1', 'ord1', { id: 'cs_miss' });
    expect(result.status).toBe('failed');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }), { merge: true });
    expect(uploadReceiptPdf).not.toHaveBeenCalled();
  });

  test('passes a discount line into the PDF when the order has a deal', async () => {
    const { renderCustomerBelegPdf } = require('../receipts/customerBelegPdf');
    mockAllocateHarness();
    const receiptGet = jest.fn()
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: true, data: () => ({ status: 'pending' }) });
    const receiptSet = jest.fn().mockResolvedValue();
    receiptRef.mockImplementation((bid, id) => ({
      id,
      businessId: bid,
      path: `businesses/${bid}/receipts/${id}`,
      kind: 'receipt',
      get: receiptGet,
      set: receiptSet,
    }));
    const orderUpdate = jest.fn().mockResolvedValue();
    ordersRef.mockReturnValue({
      doc: () => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            items: [{ name: 'Pizza Hawaii', qty: 1, vatRate: 10, net: 17.27, vat: 1.73, gross: 19 }],
            discount: 2.28,
            discountLabel: '12% Rabatt',
            deliveryFee: 2,
            totalsByVat: { '10': { net: 17.02, vat: 1.7, gross: 18.72 } },
            totalGross: 18.72,
            customerName: 'Ali',
            customerPhone: '43',
          }),
        }),
        update: orderUpdate,
      }),
    });
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Enes Kebap', legal: { legalName: 'Enes Kebap' } }),
      }),
    });

    const result = await issueCustomerBeleg('biz1', 'ordDeal', { id: 'cs_deal' });
    expect(result.status).toBe('ready');
    expect(renderCustomerBelegPdf).toHaveBeenCalledWith(expect.objectContaining({
      totalGross: 18.72,
      lines: expect.arrayContaining([
        expect.objectContaining({ name: '12% Rabatt', kind: 'discount', gross: -2.28 }),
        expect.objectContaining({ name: 'Liefergebühr', kind: 'fee' }),
      ]),
    }));
  });
});
