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

describe('allocateReceiptSlot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates new beleg number and is idempotent for same paymentRef', async () => {
    const store = new Map();
    const counter = { nextNumber: 1 };

    receiptRef.mockImplementation((_bid, id) => ({
      id,
      path: `receipts/${id}`,
    }));
    receiptCounterRef.mockReturnValue({ path: 'counters/receipts' });

    db.runTransaction.mockImplementation(async (fn) => {
      const tx = {
        get: async (ref) => {
          if (ref.path === 'counters/receipts') {
            return {
              exists: true,
              data: () => ({ ...counter }),
            };
          }
          if (store.has(ref.id)) {
            return { exists: true, data: () => store.get(ref.id) };
          }
          return { exists: false };
        },
        set: (ref, data) => {
          if (ref.path === 'counters/receipts') {
            Object.assign(counter, data);
            return;
          }
          store.set(ref.id, { ...data });
        },
      };
      return fn(tx);
    });

    const payload = {
      businessId: 'biz1',
      orderId: 'ord1',
      paymentRef: 'cs_1',
      sellerSnapshot: { legalName: 'A' },
      buyerSnapshot: { name: 'B' },
      lines: [],
      totalsByVat: { '10': { net: 1, vat: 0.1, gross: 1.1 } },
      totalGross: 1.1,
    };

    const first = await allocateReceiptSlot(payload);
    expect(first.created).toBe(true);
    expect(first.belegNumber).toBe(`WO-${new Date().getFullYear()}-000001`);
    expect(counter.nextNumber).toBe(2);

    const second = await allocateReceiptSlot(payload);
    expect(second.created).toBe(false);
    expect(second.belegNumber).toBe(first.belegNumber);
    expect(counter.nextNumber).toBe(2);
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
});
