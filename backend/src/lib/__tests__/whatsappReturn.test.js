jest.mock('../collections', () => ({
  phoneRoutingRef: jest.fn(),
}));

const { phoneRoutingRef } = require('../collections');
const {
  resolvePaymentLang,
  digitsOnly,
  waMeUrl,
  waDeepLinkUrl,
  waAndroidIntentUrl,
  resolveWhatsAppReturnPhoneDigits,
  buildPaymentReturnHtml,
} = require('../whatsappReturn');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WHATSAPP_RETURN_PHONE;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

describe('resolvePaymentLang', () => {
  test('accepts de, en, tr', () => {
    expect(resolvePaymentLang('de')).toBe('de');
    expect(resolvePaymentLang('tr')).toBe('tr');
    expect(resolvePaymentLang('en')).toBe('en');
  });

  test('falls back to en for unknown values', () => {
    expect(resolvePaymentLang('fr')).toBe('en');
    expect(resolvePaymentLang(undefined)).toBe('en');
  });
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

describe('waDeepLinkUrl', () => {
  test('builds whatsapp:// deep link', () => {
    expect(waDeepLinkUrl('436601234567')).toBe('whatsapp://send?phone=436601234567');
  });
});

describe('waAndroidIntentUrl', () => {
  test('builds Android intent with wa.me fallback', () => {
    const url = waAndroidIntentUrl('436601234567');
    expect(url).toContain('intent://send/436601234567');
    expect(url).toContain('scheme=whatsapp');
    expect(url).toContain(encodeURIComponent('https://wa.me/436601234567'));
  });
});

describe('buildPaymentReturnHtml', () => {
  test('includes deep link redirect and English tap button by default', () => {
    const html = buildPaymentReturnHtml({
      variant: 'success',
      waUrl: 'https://wa.me/436601234567',
    });
    expect(html).toContain('https://wa.me/436601234567');
    expect(html).toContain('whatsapp://send?phone=436601234567');
    expect(html).toContain('Return to WhatsApp');
    expect(html).toContain('Payment received');
    expect(html).toContain('window.location.replace');
    expect(html).toContain('lang="en"');
  });

  test('renders German copy when lang=de', () => {
    const html = buildPaymentReturnHtml({
      variant: 'success',
      lang: 'de',
      waUrl: 'https://wa.me/436601234567',
    });
    expect(html).toContain('Zahlung erhalten');
    expect(html).toContain('Zu WhatsApp zurück');
    expect(html).toContain('lang="de"');
  });

  test('shows localized fallback body when no return number', () => {
    const html = buildPaymentReturnHtml({
      variant: 'cancel',
      lang: 'tr',
    });
    expect(html).toContain('Ödeme iptal edildi');
    expect(html).toContain('WhatsApp\'a dönün');
    expect(html).not.toContain('whatsapp://');
  });
});
