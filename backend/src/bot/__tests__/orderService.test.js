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
jest.mock('../../lib/whatsappRouting', () => jest.requireActual('../../lib/whatsappRouting'));
jest.mock('../templates');

const { createOrder, getLastOrderForCustomer, getOrder, amendOrderAddItems, approveOrder, rejectOrder, startPreparation, markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder } = require('../orderService');
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
  whatsappPhoneNumberId: 'prod_phone_id',
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
        customerPhone: '43699000001',
        customerId: '43699000001',
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
      'prod_phone_id',
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
    expect(msg).toContain('43699000001');
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

    expect(sendText).toHaveBeenCalledWith('+4312345678', expect.stringContaining('ABC123'), 'prod_phone_id');
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

  test('stores whatsappPhoneNumberId when provided', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, { ...ORDER_PARAMS, whatsappPhoneNumberId: 'prod_phone_id' });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ whatsappPhoneNumberId: 'prod_phone_id' }));
  });

  // ── Customer profile upsert ────────────────────────────────────────────────

  test('upserts customer profile with phone, name and timestamps', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, ORDER_PARAMS);

    expect(mockCustomerSet).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '43699000001', name: 'Ahmet' }),
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
// State machine — transitionOrder (tested via individual functions)
// ---------------------------------------------------------------------------
describe('Order state machine', () => {
  function makeRef(orderData) {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const ref = {
      get: jest.fn().mockResolvedValue({ exists: orderData !== null, data: () => orderData }),
      update: mockUpdate,
    };
    ordersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(ref) });
    return { mockUpdate };
  }

  const ORDER = (status) => ({
    status,
    customerPhone: '+43699000001',
    language: 'tr',
    whatsappPhoneNumberId: 'prod_phone_id',
  });

  // ── approveOrder ──────────────────────────────────────────────────────────
  test('approveOrder: pending → approved, writes approvedAt, notifies customer', async () => {
    const { mockUpdate } = makeRef(ORDER('pending'));
    t.mockReturnValue('Onaylandı!');

    await approveOrder(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', approvedAt: expect.any(String), prepMins: 30, pickupTime: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderApproved', 'tr', 'ABC123', expect.any(String));
    expect(sendText).toHaveBeenCalledWith('+43699000001', 'Onaylandı!', 'prod_phone_id');
  });

  test('approveOrder: honors owner-supplied etaMinutes override', async () => {
    const { mockUpdate } = makeRef(ORDER('pending'));
    t.mockReturnValue('Onaylandı!');

    await approveOrder(BIZ, 'order_abc123', 45);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ prepMins: 45 }));
  });

  test('approveOrder: throws on invalid source state', async () => {
    makeRef(ORDER('approved'));
    await expect(approveOrder(BIZ, 'ord')).rejects.toThrow('Invalid transition');
  });

  // ── rejectOrder ───────────────────────────────────────────────────────────
  test('rejectOrder: pending → rejected, notifies with orderRejected key', async () => {
    const { mockUpdate } = makeRef(ORDER('pending'));

    await rejectOrder(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectedAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderRejected', 'tr', 'ABC123');
  });

  // ── startPreparation ──────────────────────────────────────────────────────
  test('startPreparation: approved → preparing', async () => {
    const { mockUpdate } = makeRef(ORDER('approved'));

    await startPreparation(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'preparing', preparingAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderPreparing', 'tr', 'ABC123');
  });

  // ── markReady ─────────────────────────────────────────────────────────────
  test('markReady: preparing → ready', async () => {
    const { mockUpdate } = makeRef(ORDER('preparing'));

    await markReady(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready', readyAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderReady', 'tr', 'ABC123');
  });

  test('markReady: throws when order is not in preparing state', async () => {
    makeRef(ORDER('pending'));
    await expect(markReady(BIZ, 'ord')).rejects.toThrow('Invalid transition');
  });

  // ── markOnTheWay ──────────────────────────────────────────────────────────
  test('markOnTheWay: preparing → on_the_way', async () => {
    const { mockUpdate } = makeRef(ORDER('preparing'));

    await markOnTheWay(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'on_the_way', onTheWayAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderOnTheWay', 'tr', 'ABC123');
  });

  // ── markPickedUp ──────────────────────────────────────────────────────────
  test('markPickedUp: ready → picked_up', async () => {
    const { mockUpdate } = makeRef(ORDER('ready'));

    await markPickedUp(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'picked_up', pickedUpAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderPickedUp', 'tr', 'ABC123');
  });

  // ── markDelivered ─────────────────────────────────────────────────────────
  test('markDelivered: on_the_way → delivered', async () => {
    const { mockUpdate } = makeRef(ORDER('on_the_way'));

    await markDelivered(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderDelivered', 'tr', 'ABC123');
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────
  test('cancelOrder: pending → cancelled', async () => {
    const { mockUpdate } = makeRef(ORDER('pending'));
    await cancelOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(String) }));
  });

  test('cancelOrder: approved → cancelled', async () => {
    const { mockUpdate } = makeRef(ORDER('approved'));
    await cancelOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  test('cancelOrder: preparing → cancelled', async () => {
    const { mockUpdate } = makeRef(ORDER('preparing'));
    await cancelOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  test('cancelOrder: throws when order is ready (too late to cancel)', async () => {
    makeRef(ORDER('ready'));
    await expect(cancelOrder(BIZ, 'ord')).rejects.toThrow('Invalid transition');
  });

  // ── shared behaviour ──────────────────────────────────────────────────────
  test('throws "Order not found" when document does not exist', async () => {
    makeRef(null);
    await expect(approveOrder(BIZ, 'nonexistent')).rejects.toThrow('Order not found');
  });

  test('does not throw when customer notification fails', async () => {
    makeRef(ORDER('pending'));
    sendText.mockRejectedValue(new Error('WhatsApp down'));
    await expect(approveOrder(BIZ, 'order_abc123')).resolves.toBeUndefined();
  });

  test('uses last 6 chars of orderId (uppercased) as shortId', async () => {
    makeRef(ORDER('pending'));
    await approveOrder(BIZ, 'order_ABCDEF123456');
    expect(t).toHaveBeenCalledWith('orderApproved', 'tr', '123456', expect.any(String));
  });
});

describe('getLastOrderForCustomer', () => {
  test('returns most recent non-cancelled order with items', async () => {
    const older = {
      items: [{ name: 'Ayran', qty: 1, price: 2 }],
      status: 'delivered',
      createdAt: { toMillis: () => 1000 },
    };
    const newer = {
      items: [{ name: 'Döner', qty: 2, price: 8.5 }],
      status: 'picked_up',
      createdAt: { toMillis: () => 2000 },
    };
    ordersRef.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            empty: false,
            docs: [{ data: () => older }, { data: () => newer }],
          }),
        }),
      }),
    });

    const result = await getLastOrderForCustomer(BIZ, '+43699000001');
    expect(result).toEqual(newer);
  });

  test('skips cancelled and rejected orders', async () => {
    const cancelled = {
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
      status: 'cancelled',
      createdAt: { toMillis: () => 3000 },
    };
    const valid = {
      items: [{ name: 'Ayran', qty: 1, price: 2 }],
      status: 'pending',
      createdAt: { toMillis: () => 1000 },
    };
    ordersRef.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            empty: false,
            docs: [{ data: () => cancelled }, { data: () => valid }],
          }),
        }),
      }),
    });

    const result = await getLastOrderForCustomer(BIZ, '+43699000001');
    expect(result).toEqual(valid);
  });

  test('returns null when no orders exist', async () => {
    ordersRef.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      }),
    });

    expect(await getLastOrderForCustomer(BIZ, '+43699000001')).toBeNull();
  });

  test('finds order stored with + when webhook phone has no +', async () => {
    const order = {
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
      status: 'delivered',
      customerId: '+43699000001',
      createdAt: { toMillis: () => 2000 },
    };
    ordersRef.mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue({
            empty: false,
            docs: [{ data: () => order }],
          }),
        }),
      }),
    });

    const result = await getLastOrderForCustomer(BIZ, '43699000001');
    expect(result).toEqual(order);
    expect(ordersRef().where).toHaveBeenCalledWith('customerId', 'in', expect.arrayContaining(['43699000001', '+43699000001']));
  });
});

describe('getOrder', () => {
  test('returns order with id when document exists', async () => {
    const mockGet = jest.fn().mockResolvedValue({
      exists: true,
      id: 'order_1',
      data: () => ({ status: 'pending', total: 10 }),
    });
    ordersRef.mockReturnValue({ doc: jest.fn().mockReturnValue({ get: mockGet }) });

    const result = await getOrder(BIZ, 'order_1');
    expect(result).toEqual({ id: 'order_1', status: 'pending', total: 10 });
  });

  test('returns null when missing', async () => {
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      }),
    });
    expect(await getOrder(BIZ, 'missing')).toBeNull();
  });
});

describe('amendOrderAddItems', () => {
  test('merges items and notifies owner for pending cash order', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const orderData = {
      status: 'pending',
      paymentMethod: 'cash',
      orderType: 'pickup',
      items: [{ name: 'Döner', qty: 1, price: 8 }],
      total: 8,
      customerName: 'Ali',
      customerPhone: '+43699000001',
      whatsappPhoneNumberId: 'phone_id_test',
    };
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => orderData }),
        update: mockUpdate,
      }),
    });
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ alertPhone: '+431111111', name: 'Enes' }) }),
    });

    const newItems = [{ name: 'Ayran', qty: 1, price: 2.5 }];
    const result = await amendOrderAddItems(BIZ, 'order_abc123456789', newItems);

    expect(result.applied).toEqual(newItems);
    expect(result.total).toBe(10.5);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      items: [...orderData.items, ...newItems],
      total: 10.5,
    }));
    expect(sendText).toHaveBeenCalled();
  });

  test('rejects stripe orders', async () => {
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: 'pending', paymentMethod: 'stripe', items: [] }),
        }),
      }),
    });
    await expect(amendOrderAddItems(BIZ, 'order_1', [{ name: 'Cola', qty: 1, price: 3 }])).rejects.toThrow('Card orders');
  });
});
