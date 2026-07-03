// Mock firebase so the Admin SDK never initialises.
// db.collection is a jest.fn() so each test can configure its own chain.
jest.mock('../../lib/firebase', () => ({
  db: { collection: jest.fn(), runTransaction: jest.fn() },
}));

const { db } = require('../../lib/firebase');
const { getSession, setSession, patchSession, clearSession, buildSessionWrite } = require('../sessionStore');

function mockTransaction(ref) {
  db.runTransaction.mockImplementation(async (fn) => {
    await fn({
      get: (r) => r.get(),
      set: (r, data) => r.set(data),
    });
  });
  return ref;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------
describe('getSession', () => {
  test('returns stored data when the document exists', async () => {
    const storedData = { state: 'selecting', language: 'tr', basket: [{ name: 'Döner', qty: 1, price: 8.5 }] };
    db.collection.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true, data: () => storedData }),
      }),
    });

    const result = await getSession('+43699000001');
    expect(result).toEqual(storedData);
  });

  test('returns default session when document does not exist', async () => {
    db.collection.mockReturnValue({
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      }),
    });

    const result = await getSession('+43699000001');
    expect(result).toEqual({ state: 'browsing', language: null, basket: [], businessId: null });
  });

  test('looks up the "sessions" collection with the given phone', async () => {
    const mockDoc = jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ exists: false }) });
    db.collection.mockReturnValue({ doc: mockDoc });

    await getSession('+43699000001');
    expect(db.collection).toHaveBeenCalledWith('sessions');
    expect(mockDoc).toHaveBeenCalledWith('+43699000001');
  });
});

// ---------------------------------------------------------------------------
// setSession
// ---------------------------------------------------------------------------
describe('setSession', () => {
  test('persists session data with an updatedAt timestamp', async () => {
    const mockSet = jest.fn().mockResolvedValue(undefined);
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue({ set: mockSet }) });

    await setSession('+43699000001', { state: 'browsing', language: 'en', basket: [] });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'browsing', language: 'en', basket: [], updatedAt: expect.any(Date) }),
    );
  });

  test('does not mutate the original data object', async () => {
    const mockSet = jest.fn().mockResolvedValue(undefined);
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue({ set: mockSet }) });

    const original = { state: 'browsing', language: 'tr', basket: [] };
    await setSession('+43699000001', original);

    expect(original).not.toHaveProperty('updatedAt');
  });

  test('strips undefined fields before write', async () => {
    const mockSet = jest.fn().mockResolvedValue(undefined);
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue({ set: mockSet }) });

    await setSession('+43699000001', { state: 'browsing', basket: [], pendingIntentItems: undefined });

    expect(mockSet.mock.calls[0][0]).not.toHaveProperty('pendingIntentItems');
  });
});

// ---------------------------------------------------------------------------
// buildSessionWrite
// ---------------------------------------------------------------------------
describe('buildSessionWrite', () => {
  test('preserves pending intent when only menu list id is updated', () => {
    const payload = buildSessionWrite(
      {
        state: 'browsing',
        language: 'tr',
        businessId: 'biz_test',
        basket: [],
        textMenuCategory: 'Pizza',
        textMenuIndex: [{ id: 'p1', name: 'Margherita', price: 8.5 }],
        pendingIntentItems: [{ menuItemId: 'p1', name: 'Margherita', qty: 1, price: 8.5 }],
      },
      { pendingDeleteIds: ['list_msg_id'] },
    );

    expect(payload.pendingIntentItems).toHaveLength(1);
    expect(payload.textMenuCategory).toBe('Pizza');
    expect(payload.pendingDeleteIds).toEqual(['list_msg_id']);
  });

  test('strips nested undefined inside disambiguation', () => {
    const payload = buildSessionWrite(
      { state: 'disambiguating_intent', language: 'tr', businessId: 'biz', basket: [] },
      {
        disambiguation: {
          rawName: 'cola',
          qty: 1,
          proposalEditMode: undefined,
          proposalEditBase: undefined,
          candidates: [{ id: 'c1', name: 'Cola 0.33L', price: 2.9 }],
        },
      },
    );

    expect(payload.disambiguation).toMatchObject({ rawName: 'cola', qty: 1 });
    expect(payload.disambiguation).not.toHaveProperty('proposalEditMode');
    expect(payload.disambiguation).not.toHaveProperty('proposalEditBase');
  });

  test('preserves pending intent note on proposal', () => {
    const payload = buildSessionWrite(
      { state: 'browsing', language: 'de', businessId: 'biz_test', basket: [] },
      { pendingIntentNote: 'extra scharf', pendingIntentRawText: 'kebap mit scharf' },
    );

    expect(payload.pendingIntentNote).toBe('extra scharf');
    expect(payload.pendingIntentRawText).toBe('kebap mit scharf');
  });

  test('preserves specialRequests on basket update', () => {
    const payload = buildSessionWrite(
      { state: 'browsing', language: 'de', businessId: 'biz_test', basket: [], specialRequests: 'extra scharf' },
      { basket: [{ name: 'Kebap', qty: 1, price: 7.5 }] },
    );

    expect(payload.specialRequests).toBe('extra scharf');
  });

  test('clears pending intent fields when explicitly undefined', () => {
    const payload = buildSessionWrite(
      {
        state: 'browsing',
        language: 'tr',
        businessId: 'biz_test',
        basket: [],
        textMenuCategory: 'Pizza',
        textMenuIndex: [{ id: 'p1', name: 'Margherita', price: 8.5 }],
        pendingIntentItems: [{ name: 'Döner', qty: 2, price: 8.5 }],
      },
      {
        basket: [{ name: 'Döner', qty: 2, price: 8.5 }],
        pendingDeleteIds: [],
        pendingIntentItems: undefined,
      },
    );

    expect(payload.basket).toHaveLength(1);
    expect(payload).not.toHaveProperty('pendingIntentItems');
  });

  test('preserves basketPendingLearning on unrelated patch', () => {
    const pending = {
      businessId: 'biz_test',
      text: 'cola raus',
      intent: { operation: 'remove', parsedBy: 'rules' },
      matched: [{ name: 'Coca Cola 0.33L', qty: 1 }],
    };
    const payload = buildSessionWrite(
      {
        state: 'browsing',
        language: 'de',
        businessId: 'biz_test',
        basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
        basketPendingLearning: pending,
        textMenuCategory: 'Kebap',
      },
      { pendingDeleteIds: ['list_msg_id'] },
    );

    expect(payload.basketPendingLearning).toEqual(pending);
    expect(payload.textMenuCategory).toBe('Kebap');
  });
});

// ---------------------------------------------------------------------------
// patchSession
// ---------------------------------------------------------------------------
describe('patchSession', () => {
  test('late menuId-only patch preserves pendingIntentItems from live doc', async () => {
    const liveDoc = {
      state: 'browsing',
      language: 'tr',
      businessId: 'biz_test',
      basket: [],
      textMenuCategory: 'Pizza',
      textMenuIndex: [{ id: 'p1', name: 'Margherita', price: 8.5 }],
      pendingIntentItems: [{ menuItemId: 'p1', name: 'Margherita', qty: 1, price: 8.5 }],
    };
    const mockSet = jest.fn().mockResolvedValue(undefined);
    const mockRef = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => liveDoc }),
      set: mockSet,
    };
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue(mockRef) });
    mockTransaction(mockRef);

    await patchSession('+43699000001', { menuId: 'list_msg_id' });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      pendingIntentItems: liveDoc.pendingIntentItems,
      textMenuCategory: 'Pizza',
      pendingDeleteIds: ['list_msg_id'],
    }));
  });

  test('sequential pending then menuId patch keeps pendingIntentItems', async () => {
    let stored = {
      state: 'browsing',
      language: 'tr',
      businessId: 'biz_test',
      basket: [],
      textMenuCategory: 'Pizza',
      textMenuIndex: [{ id: 'p1', name: 'Margherita', price: 8.5 }],
    };
    const mockRef = {
      get: jest.fn(async () => ({ exists: true, data: () => ({ ...stored }) })),
      set: jest.fn(async (data) => { stored = { ...data }; }),
    };
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue(mockRef) });
    mockTransaction(mockRef);

    await patchSession('+43699000001', {
      pendingIntentItems: [{ menuItemId: 'p1', name: 'Margherita', qty: 1, price: 8.5 }],
    });
    await patchSession('+43699000001', { menuId: 'list_msg_id' });

    expect(stored.pendingIntentItems).toHaveLength(1);
    expect(stored.pendingDeleteIds).toEqual(['list_msg_id']);
  });

  test('late basket mutation patch preserves textMenuIndex and pendingIntentItems', async () => {
    const liveDoc = {
      state: 'browsing',
      language: 'tr',
      businessId: 'biz_test',
      basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      textMenuCategory: 'Kebap',
      textMenuIndex: [{ id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5 }],
      pendingIntentItems: [{ menuItemId: 'k1', name: 'Kebap Sandwich Huhn', qty: 1, price: 7.5 }],
    };
    const mockSet = jest.fn().mockResolvedValue(undefined);
    const mockRef = {
      get: jest.fn().mockResolvedValue({ exists: true, data: () => liveDoc }),
      set: mockSet,
    };
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue(mockRef) });
    mockTransaction(mockRef);

    await patchSession('+43699000001', {
      basket: [
        { name: 'Döner', qty: 1, price: 8.5 },
        { name: 'Mis Ayran 0.25L', qty: 1, price: 2.5 },
      ],
      basketUndoSnapshot: { basket: liveDoc.basket },
      pendingIntentItems: undefined,
      pendingDeleteIds: [],
    });

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      basket: expect.arrayContaining([
        expect.objectContaining({ name: 'Mis Ayran 0.25L' }),
      ]),
      textMenuCategory: 'Kebap',
      textMenuIndex: liveDoc.textMenuIndex,
      pendingDeleteIds: [],
    }));
    expect(mockSet.mock.calls[0][0]).not.toHaveProperty('pendingIntentItems');
  });

  test('sequential menuId patch then basket mutation keeps menu context', async () => {
    let stored = {
      state: 'browsing',
      language: 'tr',
      businessId: 'biz_test',
      basket: [{ name: 'Döner', qty: 1, price: 8.5 }],
      textMenuCategory: 'Kebap',
      textMenuIndex: [{ id: 'k1', name: 'Kebap Sandwich Huhn', price: 7.5 }],
    };
    const mockRef = {
      get: jest.fn(async () => ({ exists: true, data: () => ({ ...stored }) })),
      set: jest.fn(async (data) => { stored = { ...data }; }),
    };
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue(mockRef) });
    mockTransaction(mockRef);

    await patchSession('+43699000001', { menuId: 'list_msg_id' });
    await patchSession('+43699000001', {
      basket: [{ name: 'Döner', qty: 2, price: 8.5 }],
      basketUndoSnapshot: { basket: [{ name: 'Döner', qty: 1, price: 8.5 }] },
      pendingDeleteIds: [],
    });

    expect(stored.textMenuCategory).toBe('Kebap');
    expect(stored.textMenuIndex).toHaveLength(1);
    expect(stored.basket[0].qty).toBe(2);
    expect(stored.pendingDeleteIds).toEqual([]);
  });
});

describe('buildSessionWrite checkout', () => {
  test('preserves checkout context fields', () => {
    const payload = buildSessionWrite(
      {
        state: 'browsing',
        language: 'de',
        businessId: 'biz_test',
        basket: [],
        orderType: 'delivery',
        deliveryAddress: 'Wien',
      },
      { basket: [{ name: 'Döner', qty: 1, price: 8.5 }] },
    );

    expect(payload.orderType).toBe('delivery');
    expect(payload.deliveryAddress).toBe('Wien');
  });
});

// ---------------------------------------------------------------------------
// clearSession
// ---------------------------------------------------------------------------
describe('clearSession', () => {
  test('deletes the session document', async () => {
    const mockDelete = jest.fn().mockResolvedValue(undefined);
    db.collection.mockReturnValue({ doc: jest.fn().mockReturnValue({ delete: mockDelete }) });

    await clearSession('+43699000001');
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  test('targets the correct phone document', async () => {
    const mockDoc = jest.fn().mockReturnValue({ delete: jest.fn().mockResolvedValue(undefined) });
    db.collection.mockReturnValue({ doc: mockDoc });

    await clearSession('+43699123456');
    expect(mockDoc).toHaveBeenCalledWith('+43699123456');
  });
});
