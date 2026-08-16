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
jest.mock('../sessionStore', () => ({
  patchSession: jest.fn().mockResolvedValue(undefined),
}));

const { createOrder, getLastOrderForCustomer, getOrder, amendOrderAddItems, approveOrder, rejectOrder, startPreparation, markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder } = require('../orderService');
const { ordersRef, businessRef, customersRef } = require('../../lib/collections');
const { sendText, sendButtonMessage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { patchSession } = require('../sessionStore');

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
  sendButtonMessage.mockResolvedValue(undefined);
  patchSession.mockResolvedValue(undefined);
  t.mockImplementation((key) => key);
  mockCustomerSet.mockResolvedValue(undefined);
  mockCustomerUpdate.mockResolvedValue(undefined);
  customersRef.mockReturnValue({ doc: jest.fn().mockReturnValue(mockCustomerDoc) });
  businessRef.mockReturnValue({
    get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  });
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
        subtotal: 17,
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

  test('persists discount snapshot fields when provided', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      total: 15,
      discountSnapshot: {
        discount: 2,
        discountDealId: 'fo1',
        discountKind: 'first_order',
        discountType: 'percent',
        discountValue: 10,
        discountLabel: '10% Willkommen',
      },
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: 17,
      total: 15,
      discount: 2,
      discountDealId: 'fo1',
      discountKind: 'first_order',
      discountType: 'percent',
      discountValue: 10,
      discountLabel: '10% Willkommen',
    }));
  });

  test('writes discount 0 when no snapshot', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    await createOrder(BIZ, ORDER_PARAMS);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ discount: 0 }));
  });

  test('owner alert includes discount line', async () => {
    makeOrdersRef();
    businessRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ alertPhone: '43699000' }) }),
    });
    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      total: 15,
      discountSnapshot: { discount: 2, discountLabel: '10% Willkommen' },
    });
    expect(sendText).toHaveBeenCalledWith(
      '43699000',
      expect.stringMatching(/10% Willkommen/),
      expect.anything(),
    );
  });

  // ── Tax snapshot (Phase 0 receipts) ────────────────────────────────────────

  test('persists tax snapshot items, totalsByVat and currency when provided', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const taxSnapshot = {
      items: [{ name: 'Döner', qty: 2, price: 8.5, unitPriceGross: 8.5, vatRate: 10, net: 15.45, vat: 1.55, gross: 17 }],
      totalsByVat: { 10: { net: 15.45, vat: 1.55, gross: 17 } },
      totalGross: 17,
    };

    await createOrder(BIZ, { ...ORDER_PARAMS, taxSnapshot });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      items: taxSnapshot.items,
      totalsByVat: taxSnapshot.totalsByVat,
      currency: 'EUR',
      total: 17,
      totalGross: 17,
    }));
  });

  test('keeps the tagged delivery fee line out of persisted items', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const basketLine = { name: 'Döner', qty: 2, price: 8.5, unitPriceGross: 8.5, vatRate: 10, net: 15.45, vat: 1.55, gross: 17 };
    const feeLine = { name: 'Delivery fee', kind: 'fee', qty: 1, price: 2.5, unitPriceGross: 2.5, vatRate: 10, net: 2.27, vat: 0.23, gross: 2.5 };
    const taxSnapshot = {
      items: [basketLine, feeLine],
      totalsByVat: { 10: { net: 17.72, vat: 1.78, gross: 19.5 } },
      totalGross: 19.5,
    };

    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      orderType: 'delivery',
      deliveryAddress: 'Naschmarkt 5, 1040 Wien',
      deliveryFee: 2.5,
      taxSnapshot,
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      items: [basketLine],
      totalsByVat: taxSnapshot.totalsByVat,
      total: 19.5,
      totalGross: 19.5,
    }));
  });

  test('filters the fee line by kind regardless of its position', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    const basketLine = { name: 'Döner', qty: 2, price: 8.5, vatRate: 10, net: 15.45, vat: 1.55, gross: 17 };
    const feeLine = { name: 'Delivery fee', kind: 'fee', qty: 1, price: 2.5, vatRate: 10, net: 2.27, vat: 0.23, gross: 2.5 };

    await createOrder(BIZ, {
      ...ORDER_PARAMS,
      taxSnapshot: {
        items: [feeLine, basketLine],
        totalsByVat: { 10: { net: 17.72, vat: 1.78, gross: 19.5 } },
        totalGross: 19.5,
      },
    });

    expect(mockSet.mock.calls[0][0].items).toEqual([basketLine]);
  });

  test('stores bare basket items when no tax snapshot is provided', async () => {
    const { mockSet } = makeOrdersRef();
    businessRef.mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });

    await createOrder(BIZ, ORDER_PARAMS);

    const doc = mockSet.mock.calls[0][0];
    expect(doc.items).toEqual(ORDER_PARAMS.items);
    expect(doc.totalsByVat).toBeUndefined();
    expect(doc.currency).toBeUndefined();
    expect(doc.totalGross).toBeUndefined();
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

  test('approveOrder: blocks unpaid Stripe order', async () => {
    makeRef({
      ...ORDER('pending'),
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
    });
    await expect(approveOrder(BIZ, 'ord')).rejects.toThrow('Payment required before kitchen status change');
  });

  test('approveOrder: allows paid Stripe order', async () => {
    const { mockUpdate } = makeRef({
      ...ORDER('pending'),
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
    });
    t.mockReturnValue('Onaylandı!');
    await approveOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  test('startPreparation: blocks failed Stripe payment', async () => {
    makeRef({
      ...ORDER('approved'),
      paymentMethod: 'stripe',
      paymentStatus: 'failed',
    });
    await expect(startPreparation(BIZ, 'ord')).rejects.toThrow('Payment required before kitchen status change');
  });

  test('rejectOrder: still allowed on unpaid Stripe order', async () => {
    const { mockUpdate } = makeRef({
      ...ORDER('pending'),
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
    });
    await rejectOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected' }));
  });

  test('cancelOrder: still allowed on unpaid Stripe order', async () => {
    const { mockUpdate } = makeRef({
      ...ORDER('pending'),
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
    });
    await cancelOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  // ── rejectOrder ───────────────────────────────────────────────────────────
  test('rejectOrder: pending → rejected with reorder buttons', async () => {
    const { mockUpdate } = makeRef(ORDER('pending'));

    await rejectOrder(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectedAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderRejected', 'tr', 'ABC123');
    expect(t).toHaveBeenCalledWith('orderCompletePrompt', 'tr');
    expect(sendButtonMessage).toHaveBeenCalledWith(
      '+43699000001',
      expect.objectContaining({
        body: expect.stringContaining('orderCompletePrompt'),
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'btn_post_reorder' }),
          expect.objectContaining({ id: 'btn_post_restaurant' }),
        ]),
      }),
      'prod_phone_id',
    );
    expect(sendText).not.toHaveBeenCalled();
    expect(patchSession).toHaveBeenCalledWith('+43699000001', { pendingAmendBusinessId: BIZ });
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
  test('markPickedUp: ready → picked_up with reorder buttons', async () => {
    const { mockUpdate } = makeRef(ORDER('ready'));

    await markPickedUp(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'picked_up', pickedUpAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderPickedUp', 'tr', 'ABC123');
    expect(t).toHaveBeenCalledWith('orderCompletePrompt', 'tr');
    expect(sendButtonMessage).toHaveBeenCalledWith(
      '+43699000001',
      expect.objectContaining({
        body: expect.stringContaining('orderCompletePrompt'),
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'btn_post_reorder' }),
          expect.objectContaining({ id: 'btn_post_restaurant' }),
        ]),
      }),
      'prod_phone_id',
    );
    expect(sendText).not.toHaveBeenCalled();
    expect(patchSession).toHaveBeenCalledWith('+43699000001', { pendingAmendBusinessId: BIZ });
  });

  // ── markDelivered ─────────────────────────────────────────────────────────
  test('markDelivered: on_the_way → delivered with reorder buttons', async () => {
    const { mockUpdate } = makeRef(ORDER('on_the_way'));

    await markDelivered(BIZ, 'order_abc123');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', deliveredAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderDelivered', 'tr', 'ABC123');
    expect(t).toHaveBeenCalledWith('orderCompletePrompt', 'tr');
    expect(sendButtonMessage).toHaveBeenCalledWith(
      '+43699000001',
      expect.objectContaining({
        body: expect.stringContaining('orderCompletePrompt'),
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'btn_post_reorder' }),
          expect.objectContaining({ id: 'btn_post_restaurant' }),
        ]),
      }),
      'prod_phone_id',
    );
    expect(sendText).not.toHaveBeenCalled();
    expect(patchSession).toHaveBeenCalledWith('+43699000001', { pendingAmendBusinessId: BIZ });
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────
  test('cancelOrder: pending → cancelled with reorder buttons', async () => {
    const { mockUpdate } = makeRef(ORDER('pending'));
    await cancelOrder(BIZ, 'order_abc123');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', cancelledAt: expect.any(String) }));
    expect(t).toHaveBeenCalledWith('orderCancelled', 'tr', 'ABC123');
    expect(sendButtonMessage).toHaveBeenCalledWith(
      '+43699000001',
      expect.objectContaining({
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'btn_post_reorder' }),
          expect.objectContaining({ id: 'btn_post_restaurant' }),
        ]),
      }),
      'prod_phone_id',
    );
    expect(patchSession).toHaveBeenCalledWith('+43699000001', { pendingAmendBusinessId: BIZ });
  });

  test('cancelOrder: skipReentry sends plain text (self-serve cancel path)', async () => {
    makeRef(ORDER('pending'));
    await cancelOrder(BIZ, 'order_abc123', { skipReentry: true });
    expect(sendText).toHaveBeenCalledWith('+43699000001', 'orderCancelled', 'prod_phone_id');
    expect(sendButtonMessage).not.toHaveBeenCalled();
    expect(patchSession).not.toHaveBeenCalled();
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
  function mockOrderedOrders(docsByCall) {
    const queue = Array.isArray(docsByCall[0]) ? [...docsByCall] : [docsByCall];
    const where = jest.fn().mockImplementation(() => {
      const docs = queue.length > 1 ? queue.shift() : queue[0];
      return {
        orderBy: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({
              empty: !docs.length,
              docs: docs.map(data => ({ data: () => data })),
            }),
          }),
        }),
      };
    });
    ordersRef.mockReturnValue({ where });
    return where;
  }

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
    mockOrderedOrders([newer, older]);

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
      paymentMethod: 'cash',
      createdAt: { toMillis: () => 1000 },
    };
    mockOrderedOrders([cancelled, valid]);

    const result = await getLastOrderForCustomer(BIZ, '+43699000001');
    expect(result).toEqual(valid);
  });

  test('skips unpaid stripe pending orders', async () => {
    const unpaid = {
      items: [{ name: 'Pommes Frites', qty: 1, price: 4.5 }],
      status: 'pending',
      paymentMethod: 'stripe',
      paymentStatus: 'pending',
      createdAt: { toMillis: () => 3000 },
    };
    const paid = {
      items: [
        { name: 'Pommes Frites', qty: 1, price: 4.5 },
        { name: 'Hamburger XXXL', qty: 1, price: 10.9 },
      ],
      status: 'delivered',
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
      createdAt: { toMillis: () => 2000 },
    };
    mockOrderedOrders([unpaid, paid]);

    const result = await getLastOrderForCustomer(BIZ, '+43699000001');
    expect(result).toEqual(paid);
  });

  test('returns null when no orders exist', async () => {
    mockOrderedOrders([]);

    expect(await getLastOrderForCustomer(BIZ, '+43699000001')).toBeNull();
  });

  test('finds order stored with + when webhook phone has no +', async () => {
    const order = {
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
      status: 'delivered',
      customerId: '+43699000001',
      createdAt: { toMillis: () => 2000 },
    };
    const where = mockOrderedOrders([order]);

    const result = await getLastOrderForCustomer(BIZ, '43699000001');
    expect(result).toEqual(order);
    expect(where).toHaveBeenCalledWith('customerPhone', '==', expect.stringMatching(/43699000001/));
  });

  test('uses equality + orderBy createdAt desc (not unscoped limit)', async () => {
    const orderBy = jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      }),
    });
    const where = jest.fn().mockReturnValue({ orderBy });
    ordersRef.mockReturnValue({ where });

    await getLastOrderForCustomer(BIZ, '43699000001');
    expect(where).toHaveBeenCalledWith('customerPhone', '==', '43699000001');
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  test('returns on first eligible hit without scanning every variant', async () => {
    const paid = {
      items: [{ name: 'Döner', qty: 1, price: 8.5 }],
      status: 'delivered',
      paymentMethod: 'stripe',
      paymentStatus: 'paid',
      createdAt: { toMillis: () => 2000 },
    };
    const where = mockOrderedOrders([paid]);

    const result = await getLastOrderForCustomer(BIZ, '43699000001');
    expect(result).toEqual(paid);
    // digits on customerPhone is enough — no +variant / customerId fan-out
    expect(where).toHaveBeenCalledTimes(1);
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
    expect(sendText).toHaveBeenCalledWith(
      '+431111111',
      expect.stringMatching(/amended \(add-on\)[\s\S]*Ayran[\s\S]*€10\.50[\s\S]*Ali/),
      'phone_id_test',
    );
  });

  test('keeps the frozen discount when items are added', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const orderData = {
      status: 'pending',
      paymentMethod: 'cash',
      orderType: 'delivery',
      items: [{ name: 'Döner', qty: 1, price: 8 }],
      subtotal: 8,
      discount: 2,
      deliveryFee: 3,
      total: 9,
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

    const result = await amendOrderAddItems(
      BIZ,
      'order_abc123456789',
      [{ name: 'Ayran', qty: 1, price: 2.5 }],
    );

    expect(result.total).toBe(11.5);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: 10.5,
      total: 11.5,
    }));
  });

  test('clamps a frozen discount to the recomputed subtotal', async () => {
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    ordersRef.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            status: 'pending',
            paymentMethod: 'cash',
            orderType: 'pickup',
            items: [{ name: 'A', qty: 1, price: 1 }],
            discount: 20,
          }),
        }),
        update: mockUpdate,
      }),
    });

    const result = await amendOrderAddItems(
      BIZ,
      'order_1',
      [{ name: 'B', qty: 1, price: 1 }],
    );

    expect(result.total).toBe(0);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: 2,
      total: 0,
    }));
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
