jest.mock('../collections', () => ({
  phoneRoutingRef: jest.fn(),
}));

const { phoneRoutingRef } = require('../collections');
const {
  digitsOnly,
  waMeUrl,
  resolveWhatsAppReturnPhoneDigits,
  buildPaymentReturnHtml,
} = require('../whatsappReturn');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WHATSAPP_RETURN_PHONE;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

describe('digitsOnly', () => {
  test('strips non-digits from E.164', () => {
    expect(digitsOnly('+43 660 1234567')).toBe('436601234567');
  });

  test('returns null for too-short values', () => {
    expect(digitsOnly('123')).toBeNull();
  });
});

describe('waMeUrl', () => {
  test('builds wa.me link', () => {
    expect(waMeUrl('436601234567')).toBe('https://wa.me/436601234567');
  });
});

describe('resolveWhatsAppReturnPhoneDigits', () => {
  test('prefers WHATSAPP_RETURN_PHONE env', async () => {
    process.env.WHATSAPP_RETURN_PHONE = '+43 660 1111111';
    await expect(resolveWhatsAppReturnPhoneDigits()).resolves.toBe('436601111111');
    expect(phoneRoutingRef).not.toHaveBeenCalled();
  });

  test('falls back to phoneRouting displayNumber', async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone_id_1';
    phoneRoutingRef.mockReturnValue({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ displayNumber: '+43 660 2222222' }),
      }),
    });
    await expect(resolveWhatsAppReturnPhoneDigits()).resolves.toBe('436602222222');
  });
});

describe('buildPaymentReturnHtml', () => {
  test('includes auto-redirect when waUrl provided', () => {
    const html = buildPaymentReturnHtml({
      title: 'Payment received',
      body: 'fallback',
      waUrl: 'https://wa.me/436601234567',
    });
    expect(html).toContain('https://wa.me/436601234567');
    expect(html).toContain('Returning to WhatsApp');
  });
});
