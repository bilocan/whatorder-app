jest.mock('../collections', () => ({
  phoneRoutingByBusinessQuery: jest.fn(),
}));

const { phoneRoutingByBusinessQuery } = require('../collections');
const { resolvePhoneNumberIdForBusiness, resolvePhoneNumberIdForOrder } = require('../whatsappRouting');

describe('resolvePhoneNumberIdForBusiness', () => {
  const prevEnvId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  afterEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = prevEnvId;
    jest.clearAllMocks();
  });

  test('returns env fallback when businessId is missing', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'env_phone';
    expect(await resolvePhoneNumberIdForBusiness(null)).toBe('env_phone');
  });

  test('returns single phoneRouting doc id', async () => {
    phoneRoutingByBusinessQuery.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        empty: false,
        size: 1,
        docs: [{ id: 'prod_phone' }],
      }),
    });

    expect(await resolvePhoneNumberIdForBusiness('biz_a')).toBe('prod_phone');
  });

  test('prefers env id when multiple routing docs match', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone';
    phoneRoutingByBusinessQuery.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        empty: false,
        size: 2,
        docs: [{ id: 'prod_phone' }, { id: 'test_phone' }],
      }),
    });

    expect(await resolvePhoneNumberIdForBusiness('biz_a')).toBe('test_phone');
  });
});

describe('resolvePhoneNumberIdForOrder', () => {
  test('uses whatsappPhoneNumberId stored on the order', async () => {
    expect(await resolvePhoneNumberIdForOrder({ whatsappPhoneNumberId: 'stored_phone' }, 'biz_a')).toBe('stored_phone');
  });
});
