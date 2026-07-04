jest.mock('../../lib/firebase', () => ({
  admin: {
    firestore: {
      FieldValue: {
        increment: jest.fn(n => ({ __increment: n })),
        serverTimestamp: jest.fn(() => ({ __serverTimestamp: true })),
      },
    },
  },
}));

const mockGet = jest.fn();
const mockSet = jest.fn().mockResolvedValue(undefined);

jest.mock('../../lib/collections', () => ({
  commandLearningRef: jest.fn(() => ({
    get: mockGet,
    set: mockSet,
  })),
}));

const { commandLearningRef } = require('../../lib/collections');
const {
  lookupLearnedCommand,
  rememberLearnedCommand,
  recordLearnedCommandHit,
  _resetCommandCache,
} = require('../commandLearning');

describe('commandLearning', () => {
  beforeEach(() => {
    _resetCommandCache();
    mockGet.mockReset();
    mockSet.mockClear();
    commandLearningRef.mockClear();
  });

  test('lookup returns in-memory hit without Firestore', async () => {
    await rememberLearnedCommand('zeig mal', 'view_basket');
    mockGet.mockResolvedValue({ exists: false });

    const hit = await lookupLearnedCommand('zeig mal');
    expect(hit).toBe('view_basket');
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('lookup loads from Firestore on cold memory', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ command: 'view_basket', textKey: 'zeig mal' }),
    });

    const hit = await lookupLearnedCommand('zeig mal');
    expect(hit).toBe('view_basket');
    expect(commandLearningRef).toHaveBeenCalled();

    mockGet.mockClear();
    const cached = await lookupLearnedCommand('zeig mal');
    expect(cached).toBe('view_basket');
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('rememberLearnedCommand writes to Firestore', async () => {
    await rememberLearnedCommand('was hab ich bestellt', 'view_basket');

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        textKey: expect.any(String),
        command: 'view_basket',
        source: 'llm',
      }),
      { merge: true },
    );
  });

  test('recordLearnedCommandHit bumps hitCount', () => {
    recordLearnedCommandHit('zeig mal');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        hitCount: expect.objectContaining({ __increment: 1 }),
      }),
      { merge: true },
    );
  });

  test('rejects invalid commands', async () => {
    await rememberLearnedCommand('foo', 'not_a_command');
    expect(mockSet).not.toHaveBeenCalled();
    expect(await lookupLearnedCommand('foo')).toBeNull();
  });
});
