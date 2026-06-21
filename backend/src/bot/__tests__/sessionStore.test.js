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
