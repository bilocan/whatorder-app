jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../sessionStore', () => ({
  setSession: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../lib/whatsapp', () => ({
  sendLocationRequest: jest.fn().mockResolvedValue('loc_1'),
}));
jest.mock('../../lib/messageIdentity', () => ({
  setMessageIdentity: jest.fn(),
  PLATFORM_IDENTITY: { name: 'WhatOrder' },
}));
jest.mock('../templates', () => ({
  t: jest.fn((_key, _lang, ...args) => `t:${_key}:${args.join(',')}`),
}));
jest.mock('../../lib/collections', () => ({
  phoneRoutingRef: jest.fn(),
}));

const { phoneRoutingRef } = require('../../lib/collections');
const { isMultiRestaurantLine, beginRestaurantSwitch } = require('../restaurantSwitch');
const { setSession } = require('../sessionStore');
const { sendLocationRequest } = require('../../lib/whatsapp');

describe('isMultiRestaurantLine', () => {
  const prevEnv = process.env.WHATSAPP_PHONE_NUMBER_ID;

  afterEach(() => {
    jest.clearAllMocks();
    if (prevEnv === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    else process.env.WHATSAPP_PHONE_NUMBER_ID = prevEnv;
  });

  test('false without businessId', async () => {
    expect(await isMultiRestaurantLine(null, 'phone_multi')).toBe(false);
  });

  test('false without phoneNumberId and without env', async () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(await isMultiRestaurantLine('biz_a')).toBe(false);
    expect(phoneRoutingRef).not.toHaveBeenCalled();
  });

  test('uses session phoneNumberId and requires business on that multi line', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a', 'biz_b'] }),
      }),
    });
    expect(await isMultiRestaurantLine('biz_a', 'phone_multi')).toBe(true);
    expect(phoneRoutingRef).toHaveBeenCalledWith('phone_multi');
  });

  test('false when line is single-restaurant even if business matches', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a'] }),
      }),
    });
    expect(await isMultiRestaurantLine('biz_a', 'phone_single')).toBe(false);
  });

  test('false when business is not on the current line', async () => {
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_x', 'biz_y'] }),
      }),
    });
    expect(await isMultiRestaurantLine('biz_a', 'phone_other')).toBe(false);
  });

  test('falls back to WHATSAPP_PHONE_NUMBER_ID when phoneNumberId omitted', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone_env';
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ businessIds: ['biz_a', 'biz_b'] }),
      }),
    });
    expect(await isMultiRestaurantLine('biz_a')).toBe(true);
    expect(phoneRoutingRef).toHaveBeenCalledWith('phone_env');
  });
});

describe('beginRestaurantSwitch', () => {
  test('persists awaiting_location before location request', async () => {
    const order = [];
    setSession.mockImplementation(async () => { order.push('setSession'); });
    sendLocationRequest.mockImplementation(async () => {
      order.push('sendLocationRequest');
      return 'loc_1';
    });

    await beginRestaurantSwitch({ from: '+43000', lang: 'de' });

    expect(order[0]).toBe('setSession');
    expect(order).toContain('sendLocationRequest');
    expect(setSession).toHaveBeenCalledWith('+43000', expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
      basket: [],
    }));
  });

  test('keeps cleared venue if location request fails', async () => {
    sendLocationRequest.mockRejectedValueOnce(new Error('meta down'));

    await beginRestaurantSwitch({ from: '+43000', lang: 'de' });

    expect(setSession).toHaveBeenCalledWith('+43000', expect.objectContaining({
      state: 'awaiting_location',
      businessId: null,
      basket: [],
    }));
  });
});
