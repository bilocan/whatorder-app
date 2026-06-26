jest.mock('../collections', () => ({
  phoneRoutingByBusinessQuery: jest.fn(),
}));

const { phoneRoutingByBusinessQuery } = require('../collections');
const {
  resolveSendPhoneNumberId,
  resolvePhoneNumberIdForBusiness,
  resolvePhoneNumberIdForOrder,
} = require('../whatsappRouting');

describe('resolveSendPhoneNumberId', () => {
  const prevEnvId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = prevEnvId;
    warnSpy.mockRestore();
  });

  test('returns env when stored differs (cross-deployment order)', () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone';
    expect(resolveSendPhoneNumberId('prod_phone')).toBe('test_phone');
    expect(warnSpy).toHaveBeenCalled();
  });

  test('returns stored when it matches env', () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'prod_phone';
    expect(resolveSendPhoneNumberId('prod_phone')).toBe('prod_phone');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('returns stored when env is unset', () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(resolveSendPhoneNumberId('prod_phone')).toBe('prod_phone');
  });
});

describe('resolvePhoneNumberIdForBusiness', () => {
  const prevEnvId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  afterEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = prevEnvId;
    jest.clearAllMocks();
  });

  test('prefers env over phoneRouting when env is set', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'env_phone';
    expect(await resolvePhoneNumberIdForBusiness('biz_a')).toBe('env_phone');
    expect(phoneRoutingByBusinessQuery).not.toHaveBeenCalled();
  });

  test('falls back to phoneRouting when env is unset', async () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    phoneRoutingByBusinessQuery.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        empty: false,
        docs: [{ id: 'prod_phone' }],
      }),
    });

    expect(await resolvePhoneNumberIdForBusiness('biz_a')).toBe('prod_phone');
  });
});

describe('resolvePhoneNumberIdForOrder', () => {
  const prevEnvId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  afterEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = prevEnvId;
  });

  test('uses stored id when it matches env', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'prod_phone';
    expect(await resolvePhoneNumberIdForOrder({ whatsappPhoneNumberId: 'prod_phone' }, 'biz_a')).toBe('prod_phone');
  });

  test('uses env when stored is from another deployment', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone';
    expect(await resolvePhoneNumberIdForOrder({ whatsappPhoneNumberId: 'prod_phone' }, 'biz_a')).toBe('test_phone');
  });
});
