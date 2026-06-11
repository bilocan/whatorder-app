jest.mock('../../lib/collections');
jest.mock('../../lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn().mockReturnValue('__serverTimestamp__'),
        increment: jest.fn((n) => ({ __increment: n })),
        arrayUnion: jest.fn((v) => ({ __arrayUnion: v })),
      },
    },
  },
}));
jest.mock('../../lib/whatsapp');
jest.mock('../templates');

const { createOrder, markOrderReady } = require('../orderService');
const { ordersRef, businessRef, customersRef } = require('../../lib/collections');
const { sendText } = require('../../lib/whatsapp');
const { t } = require('../templates');

const BIZ = 'biz_test';

const ORDER_PARAMS = {
  customerPhone: '+43699000001',
  customerName: 'Ahmet',
  items: [{ name: 'Döner', qty: 2, price: 8.5 }],
  total: 17,
  language: 'tr',
  pickupTime: '14:30',
};

const mockCustomerSet = jest.fn().mockResolvedValue(undefined);
const mockCustomerUpdate = jest.fn().mockResolvedValue(undefined);
const mockCustomerDoc = { set: mockCustomerSet, update: mockCustomerUpdate };

beforeEach(() => {
  jest.clearAllMocks();
  sendText.mockResolvedValue(undefined);
  t.mockReturnValue('Your order is ready!');
  mockCustomerSet.mockResolvedValue(undefined);
  mockCustomerUpdate.mockResolvedValue(undefined);
  customersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(mockCustomerDoc) });
});

// ---------------------------------------------------------------------------
// createOrder
// ---------------------------------------------------------------------------
describe('createOrder', () => {
  function makeOrdersRef(id = 'order_abc123') {
    const mockSet = jest.fn().mockResolvedValue(undefined);
    const ref = { id, set: mockSet };
    ordersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(ref) });
    return { ref, mockSet };
  }

  test('creates the order document and returns its id', async () => {
    const { mockSet } = makeOrdersRef('order_abc123');
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    const id = await createOrder(BIZ, ORDER_PARAMS);

    expect(id).toBe('order_abc123');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order_abc123',
        customerPhone: '+43699000001',
        customerName: 'Ahmet',
        items: ORDER_PARAMS.items,
        total: 17,
        status: 'pending',
        source: 'whatsapp',
        pickupTime: '14:30',
      }),
    );
  });

  test('notifies the owner when the business has a phone number', async () => {
    makeOrdersRef('order_abc123');
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ alertPhone: '+4312345678', name: 'Döner Palace' }),
      }),
    });

    await createOrder(BIZ, ORDER_PARAMS);

    expect(sendText).toHaveBeenCalledWith(
      '+4312345678',
      expect.stringContaining('New Order'),
    );
  });

  test('includes item lines and total in owner notification', async () => {
    makeOrdersRef('order_abc123');
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ alertPhone: '+4312345678' }),
      }),
    });

    await createOrder(BIZ, ORDER_PARAMS);

    const msg = sendText.mock.calls[0][1];
    expect(msg).toContain('Döner');
    expect(msg).toContain('€17.00');
    expect(msg).toContain('+43699000001');
  });

  test('uses the last 6 chars of the id (uppercased) as shortId in notification', async () => {
    makeOrdersRef('order_abc123');
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ alertPhone: '+4312345678' }),
      }),
    });

    await createOrder(BIZ, ORDER_PARAMS);

    expect(sendText).toHaveBeenCalledWith('+4312345678', expect.stringContaining('ABC123'));
  });

  test('does not send owner notification when business has no alertPhone', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Döner Palace' }), // no alertPhone field
      }),
    });

    await createOrder(BIZ, ORDER_PARAMS);
    expect(sendText).not.toHaveBeenCalled();
  });

  test('does not throw when owner notification fails', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ alertPhone: '+4312345678' }) }),
    });
    sendText.mockRejectedValue(new Error('WhatsApp down'));

    await expect(createOrder(BIZ, ORDER_PARAMS)).resolves.toBe('order_abc123');
  });

  test('defaults customerName to "WhatsApp Customer" when omitted', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, { ...ORDER_PARAMS, customerName: null });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'WhatsApp Customer' }));
  });

  test('defaults language to "en" when omitted', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, { ...ORDER_PARAMS, language: null });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }));
  });

  test('sets pickupTime to null when omitted', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, { ...ORDER_PARAMS, pickupTime: undefined });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ pickupTime: null }));
  });

  // ── Customer profile upsert ────────────────────────────────────────────────

  test('upserts customer profile with phone, name and timestamps', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, ORDER_PARAMS);

    expect(mockCustomerSet).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+43699000001', name: 'Ahmet' }),
      { merge: true },
    );
  });

  test('increments orderCount and totalSpent on customer profile', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, ORDER_PARAMS);

    expect(mockCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ orderCount: { __increment: 1 }, totalSpent: { __increment: 17 } }),
    );
  });

  test('does not throw when customer profile upsert fails', async () => {
    makeOrdersRef('order_abc123');
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    mockCustomerSet.mockRejectedValue(new Error('Firestore offline'));

    await expect(createOrder(BIZ, ORDER_PARAMS)).resolves.toBe('order_abc123');
  });

  // ── Delivery order ─────────────────────────────────────────────────────────

  test('delivery order stores orderType, deliveryAddress, deliveryFee and adds fee to total', async () => {
    const { mockSet } = makeOrdersRef('order_del123');
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      deliveryFee: 2.5,
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      deliveryFee: 2.5,
      total: 19.5,
    }));
  });

  test('delivery order totalSpent increment includes delivery fee', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, { ...ORDER_PARAMS, orderType: 'delivery', deliveryAddress: 'Somestr. 1', deliveryFee: 2.5 });

    expect(mockCustomerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ totalSpent: { __increment: 19.5 } }),
    );
  });

  test('delivery order saves lastDeliveryAddress and savedAddresses to customer profile', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      deliveryFee: 2,
    });

    expect(mockCustomerUpdate).toHaveBeenCalledWith(expect.objectContaining({
      lastDeliveryAddress: 'Mariahilfer Str. 10, 1060 Wien',
      savedAddresses: { __arrayUnion: 'Mariahilfer Str. 10, 1060 Wien' },
    }));
  });

  test('pickup order does not write delivery address to customer profile', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, { ...ORDER_PARAMS, orderType: 'pickup' });

    const deliveryCalls = mockCustomerUpdate.mock.calls.filter(
      ([arg]) => arg.lastDeliveryAddress !== undefined,
    );
    expect(deliveryCalls).toHaveLength(0);
  });

  test('owner notification for delivery order includes address and Delivery label', async () => {
    makeOrdersRef('order_del123');
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ alertPhone: '+4312345678', name: 'Döner Palace' }),
      }),
    });

    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      orderType: 'delivery',
      deliveryAddress: 'Mariahilfer Str. 10',
      deliveryFee: 2.5,
    });

    const msg = sendText.mock.calls[0][1];
    expect(msg).toContain('Delivery');
    expect(msg).toContain('Mariahilfer Str. 10');
    expect(msg).toContain('€19.50');
  });
});

// ---------------------------------------------------------------------------
// markOrderReady
// ---------------------------------------------------------------------------
describe('markOrderReady', () => {
  const PENDING_ORDER = { status: 'pending', customerPhone: '+43699000001', language: 'tr' };

  function makeRef(orderData) {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const mockGet = jest.fn().mockResolvedValue({
      exists: orderData !== null,
      data: () => orderData,
    });
    const ref = { get: mockGet, update: mockUpdate };
    ordersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(ref) });
    return { mockUpdate };
  }

  test('updates status to "ready" with a readyAt timestamp', async () => {
    const { mockUpdate } = makeRef(PENDING_ORDER);

    await markOrderReady(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', readyAt: expect.any(String) }),
    );
  });

  test('sends customer notification with translated message', async () => {
    makeRef(PENDING_ORDER);
    t.mockReturnValue('Siparişiniz hazır!');

    await markOrderReady(BIZ, 'order_abc123');

    expect(sendText).toHaveBeenCalledWith(PENDING_ORDER.customerPhone, 'Siparişiniz hazır!');
  });

  test('uses the correct shortId (last 6 chars, uppercased) in the notification', async () => {
    makeRef(PENDING_ORDER);

    await markOrderReady(BIZ, 'order_ABCDEF123456');

    expect(t).toHaveBeenCalledWith('orderReady', 'tr', '123456');
  });

  test('throws "Order not found" when document does not exist', async () => {
    makeRef(null);
    await expect(markOrderReady(BIZ, 'nonexistent')).rejects.toThrow('Order not found');
  });

  test('throws "Order is not pending" when status is already ready', async () => {
    makeRef({ ...PENDING_ORDER, status: 'ready' });
    await expect(markOrderReady(BIZ, 'order_abc123')).rejects.toThrow('Order is not pending');
  });

  test('does not throw when customer notification fails', async () => {
    makeRef(PENDING_ORDER);
    sendText.mockRejectedValue(new Error('WhatsApp down'));

    await expect(markOrderReady(BIZ, 'order_abc123')).resolves.toBeUndefined();
  });
});
