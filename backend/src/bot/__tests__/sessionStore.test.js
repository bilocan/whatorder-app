// Mock firebase so the Admin SDK never initialises.
// db.collection is a jest.fn() so each test can configure its own chain.
jest.mock('../../lib/firebase', () => ({
  db: { collection: jest.fn() },
}));

const { db } = require('../../lib/firebase');
const { getSession, setSession, clearSession } = require('../sessionStore');

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
    expect(result).toEqual({ state: 'browsing', language: null, basket: [] });
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
