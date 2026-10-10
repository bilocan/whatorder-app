const crypto = require('crypto');

jest.mock('../firebase', () => ({
  db: { runTransaction: jest.fn() },
  admin: { firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'TS') } } },
}));

jest.mock('../collections', () => ({
  wallboardChatRef: jest.fn(),
  wallboardChatKeyRef: jest.fn(),
  customersRef: jest.fn(),
}));

jest.mock('../../bot/sessionStore', () => ({
  getSession: jest.fn(),
}));

jest.mock('../../bot/menuService', () => ({
  getBusinessInfo: jest.fn(),
}));

const { db } = require('../firebase');
const { wallboardChatRef, wallboardChatKeyRef, customersRef } = require('../collections');
const { getSession } = require('../../bot/sessionStore');
const { getBusinessInfo } = require('../../bot/menuService');
const {
  recordWallboardInbound,
  noteWallboardRestaurant,
  markWallboardChatOrdered,
  updateRestaurant,
} = require('../wallboardChat');

const PHONE = '+43 660 1112233';
const DIGITS = '436601112233';
const FAIL = '[wallboard] chat write failed';

function expectedKeyId(phone = DIGITS) {
  return crypto.createHmac('sha256', 'test-secret').update(phone).digest('hex');
}

function harness({ key = null, customers = {}, chat = null } = {}) {
  const store = { key, chat, customers: { ...customers } };
  const tx = {
    get: jest.fn(async (ref) => {
      if (ref.kind === 'key') return { exists: !!store.key, data: () => store.key };
      if (ref.kind === 'chat') return { exists: !!store.chat, data: () => store.chat };
      const hit = store.customers[ref.bid] === true;
      return { exists: hit, data: () => (hit ? { phone: '43660111' } : {}) };
    }),
    set: jest.fn((ref, data, opts) => {
      if (ref.kind === 'key') store.key = opts && opts.merge ? { ...store.key, ...data } : data;
      if (ref.kind === 'chat') store.chat = data;
    }),
  };
  const orderChecks = [];
  db.runTransaction.mockImplementation(async (fn) => {
    const getsBefore = tx.get.mock.calls.length;
    const setsBefore = tx.set.mock.calls.length;
    const result = await fn(tx);
    orderChecks.push({
      gets: tx.get.mock.invocationCallOrder.slice(getsBefore),
      sets: tx.set.mock.invocationCallOrder.slice(setsBefore),
    });
    return result;
  });
  wallboardChatKeyRef.mockImplementation(() => ({ kind: 'key' }));
  wallboardChatRef.mockImplementation((id) => ({ kind: 'chat', id }));
  customersRef.mockImplementation((bid) => ({ doc: () => ({ kind: 'customer', bid }) }));
  return { store, tx, orderChecks };
}

function expectReadsBeforeWrites(orderChecks) {
  for (const { gets, sets } of orderChecks) {
    if (!sets.length) continue;
    expect(gets.length).toBeGreaterThan(0);
    expect(Math.max(...gets)).toBeLessThan(Math.min(...sets));
  }
}

function chatSets(tx) {
  return tx.set.mock.calls.filter((call) => call[0] && call[0].kind === 'chat');
}

let uuidSpy;
const originalConsoleError = console.error;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WALLBOARD_CHAT_HASH_KEY = 'test-secret';
  console.error = jest.fn();
  if (uuidSpy) uuidSpy.mockRestore();
  uuidSpy = jest.spyOn(crypto, 'randomUUID')
    .mockReturnValueOnce('chat-1')
    .mockReturnValueOnce('chat-2');
});

afterEach(() => {
  console.error = originalConsoleError;
  jest.useRealTimers();
  if (uuidSpy) uuidSpy.mockRestore();
  uuidSpy = null;
});

describe('recordWallboardInbound', () => {
  test('missing WALLBOARD_CHAT_HASH_KEY resolves without a transaction and logs only the fixed line', async () => {
    delete process.env.WALLBOARD_CHAT_HASH_KEY;
    harness();
    await expect(recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: ['biz_a'],
    })).resolves.toBeUndefined();
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(FAIL);
  });

  test('first insert with no customer doc stores channel and a private key id', async () => {
    const { store, tx, orderChecks } = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: ['biz_a'],
    });

    const keyId = expectedKeyId();
    expect(keyId).not.toBe(DIGITS);
    expect(wallboardChatKeyRef).toHaveBeenCalledWith(keyId);
    expect(wallboardChatKeyRef).not.toHaveBeenCalledWith(DIGITS);
    expect(wallboardChatKeyRef).not.toHaveBeenCalledWith(PHONE);

    expect(store.key).toMatchObject({
      firstSeenAt: 'TS',
      chatId: 'chat-1',
    });
    expect(store.key.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(store.key)).not.toContain(DIGITS);
    expect(JSON.stringify(store.key)).not.toContain(keyId);

    expect(chatSets(tx)).toHaveLength(1);
    expect(chatSets(tx)[0][0].id).toBe('chat-1');
    expect(chatSets(tx)[0][1]).toEqual({
      startedAt: 'TS',
      channel: 'qr',
      newNumber: true,
      businessId: null,
      restaurantName: null,
      ordered: false,
      updatedAt: 'TS',
    });
    expect(JSON.stringify(chatSets(tx)[0][1])).not.toContain(keyId);
    expect(JSON.stringify(chatSets(tx)[0][1])).not.toContain(DIGITS);
    expect(customersRef).toHaveBeenCalledWith('biz_a');
    expectReadsBeforeWrites(orderChecks);
    expect(console.error).not.toHaveBeenCalled();
  });

  test('an existing customer doc is returning and no chat history is copied', async () => {
    const { tx, orderChecks } = harness({ customers: { biz_a: true } });
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: ['biz_a'],
    });
    expect(chatSets(tx)[0][1].newNumber).toBe(false);
    expect(JSON.stringify(chatSets(tx)[0][1])).not.toContain('43660111');
    expect(chatSets(tx)[0][1]).not.toHaveProperty('phone');
    expectReadsBeforeWrites(orderChecks);
  });

  test('same dayKey keeps the first channel and updates the restaurant while unordered', async () => {
    const { store, tx, orderChecks } = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: [],
    });
    const setsAfterCreate = tx.set.mock.calls.length;

    await recordWallboardInbound({
      phone: PHONE,
      channel: 'web',
      businessIds: [],
    });
    expect(tx.set.mock.calls.length).toBe(setsAfterCreate);
    expect(store.chat.channel).toBe('qr');

    await recordWallboardInbound({
      phone: PHONE,
      channel: 'web',
      businessIds: [],
      businessId: 'biz_b',
      restaurantName: 'Ada',
    });
    const update = chatSets(tx).at(-1);
    expect(update[1]).toEqual({
      businessId: 'biz_b',
      restaurantName: 'Ada',
      updatedAt: 'TS',
    });
    expect(update[2]).toEqual({ merge: true });
    expect(update[1]).not.toHaveProperty('channel');
    expectReadsBeforeWrites(orderChecks);
  });

  test('same day and ordered true does not change the restaurant', async () => {
    const { store, tx, orderChecks } = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: [],
      businessId: 'biz_a',
      restaurantName: 'Enes',
    });
    store.chat.ordered = true;
    const sets = tx.set.mock.calls.length;

    await recordWallboardInbound({
      phone: PHONE,
      channel: 'web',
      businessIds: [],
      businessId: 'biz_b',
      restaurantName: 'Other',
    });
    expect(tx.set.mock.calls.length).toBe(sets);
    expect(store.chat.businessId).toBe('biz_a');
    expect(store.chat.restaurantName).toBe('Enes');
    expect(store.chat.channel).toBe('qr');
    expectReadsBeforeWrites(orderChecks);
  });

  test('the next Vienna day opens a new chat and leaves the first channel', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-10T10:00:00.000Z'));
    const { store, tx, orderChecks } = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: ['biz_a'],
    });
    const firstChat = { ...store.chat };
    expect(store.key.chatId).toBe('chat-1');
    expect(store.key.dayKey).toBe('2026-10-10');
    expect(firstChat.channel).toBe('qr');
    expect(firstChat.newNumber).toBe(true);

    jest.setSystemTime(new Date('2026-10-11T10:00:00.000Z'));
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'web',
      businessIds: ['biz_a'],
    });
    expect(store.key.chatId).toBe('chat-2');
    expect(store.key.dayKey).toBe('2026-10-11');
    expect(store.key.firstSeenAt).toBe('TS');
    expect(store.chat).toMatchObject({
      channel: 'web',
      newNumber: false,
      ordered: false,
      startedAt: 'TS',
    });
    expect(firstChat.channel).toBe('qr');
    expect(wallboardChatRef).toHaveBeenCalledWith('chat-1');
    expect(wallboardChatRef).toHaveBeenCalledWith('chat-2');
    expect(chatSets(tx).map((call) => call[0].id)).toEqual(['chat-1', 'chat-2']);
    expectReadsBeforeWrites(orderChecks);
  });

  test('a rejected transaction resolves and logs only the fixed line', async () => {
    harness();
    db.runTransaction.mockRejectedValue(new Error(`boom ${DIGITS} ${expectedKeyId()}`));
    await expect(recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: [],
    })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(FAIL);
    expect(console.error.mock.calls.flat().join(' ')).not.toContain(DIGITS);
    expect(console.error.mock.calls.flat().join(' ')).not.toContain(expectedKeyId());
  });
});

describe('markWallboardChatOrdered', () => {
  test('sets ordered and the order restaurant once, and does not create a chat without a key', async () => {
    const { store, tx, orderChecks } = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: [],
      businessId: 'biz_a',
      restaurantName: 'Enes',
    });

    await markWallboardChatOrdered({
      phone: PHONE,
      businessId: 'biz_order',
      restaurantName: 'Order Place',
    });
    expect(chatSets(tx).at(-1)[1]).toEqual({
      ordered: true,
      businessId: 'biz_order',
      restaurantName: 'Order Place',
      updatedAt: 'TS',
    });
    expect(chatSets(tx).at(-1)[2]).toEqual({ merge: true });
    const sets = tx.set.mock.calls.length;

    await markWallboardChatOrdered({
      phone: PHONE,
      businessId: 'biz_later',
      restaurantName: 'Later',
    });
    expect(tx.set.mock.calls.length).toBe(sets);
    expect(store.chat.restaurantName).toBe('Order Place');
    expect(store.chat.businessId).toBe('biz_order');

    const missing = harness();
    await markWallboardChatOrdered({
      phone: PHONE,
      businessId: 'biz_a',
      restaurantName: 'Enes',
    });
    expect(missing.store.chat).toBeNull();
    expect(missing.store.key).toBeNull();
    expect(missing.tx.set).not.toHaveBeenCalled();
    expectReadsBeforeWrites(orderChecks);
    expectReadsBeforeWrites(missing.orderChecks);
  });
});

describe('noteWallboardRestaurant', () => {
  test('does not write when the session has no business, and does not create a row when the key is missing', async () => {
    getSession.mockResolvedValue({ businessId: null });
    const idle = harness();
    await noteWallboardRestaurant(PHONE);
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(idle.tx.set).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    const missing = harness();
    getSession.mockResolvedValue({ businessId: 'biz_a' });
    getBusinessInfo.mockResolvedValue({ name: 'Enes' });
    await noteWallboardRestaurant(PHONE);
    expect(missing.store.chat).toBeNull();
    expect(missing.store.key).toBeNull();
    expect(missing.tx.set).not.toHaveBeenCalled();
    expect(missing.tx.get).toHaveBeenCalled();
    expectReadsBeforeWrites(missing.orderChecks);
  });

  test('sets the business name, and still stores the id when getBusinessInfo throws', async () => {
    const named = harness();
    const { orderChecks } = named;
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'direct',
      businessIds: [],
    });
    getSession.mockResolvedValue({ businessId: 'biz_a' });
    getBusinessInfo.mockResolvedValue({ name: 'Enes' });
    await noteWallboardRestaurant(PHONE);
    expect(chatSets(named.tx).at(-1)[1]).toEqual({
      businessId: 'biz_a',
      restaurantName: 'Enes',
      updatedAt: 'TS',
    });
    expect(chatSets(named.tx).at(-1)[2]).toEqual({ merge: true });
    expect(named.store.chat.ordered).toBeUndefined();
    named.store.chat.ordered = true;
    const setsAfterName = named.tx.set.mock.calls.length;
    getSession.mockResolvedValue({ businessId: 'biz_b' });
    getBusinessInfo.mockResolvedValue({ name: 'Other' });
    await noteWallboardRestaurant(PHONE);
    expect(named.tx.set.mock.calls.length).toBe(setsAfterName);
    expect(named.store.chat.restaurantName).toBe('Enes');

    const fresh = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: [],
    });
    expect(fresh.store.chat.restaurantName).toBeNull();
    getSession.mockResolvedValue({ businessId: 'biz_a' });
    getBusinessInfo.mockRejectedValue(new Error('no name'));
    await noteWallboardRestaurant(PHONE);
    expect(chatSets(fresh.tx).at(-1)[1]).toEqual({
      businessId: 'biz_a',
      restaurantName: null,
      updatedAt: 'TS',
    });
    expect(console.error).not.toHaveBeenCalled();
    expectReadsBeforeWrites(orderChecks);
    expectReadsBeforeWrites(fresh.orderChecks);
  });

  test('awaiting_language uses pendingDeepBid instead of the restaurant the re-prompt kept', async () => {
    const { store, tx } = harness();
    await recordWallboardInbound({
      phone: PHONE,
      channel: 'qr',
      businessIds: ['biz_old', 'biz_new'],
      businessId: 'biz_new',
      restaurantName: 'New Place',
    });
    const setsAfterRecord = tx.set.mock.calls.length;
    getSession.mockResolvedValue({
      state: 'awaiting_language',
      businessId: 'biz_old',
      pendingDeepBid: 'biz_new',
    });
    getBusinessInfo.mockImplementation(async (id) => (
      { name: id === 'biz_new' ? 'New Place' : 'Old Place' }
    ));
    await noteWallboardRestaurant(PHONE);
    expect(tx.set.mock.calls.length).toBe(setsAfterRecord);
    expect(store.chat.businessId).toBe('biz_new');
    expect(store.chat.restaurantName).toBe('New Place');
    expect(getBusinessInfo).toHaveBeenCalledWith('biz_new');
  });
});

describe('exports', () => {
  test('updateRestaurant is not exported', () => {
    expect(updateRestaurant).toBeUndefined();
  });
});
