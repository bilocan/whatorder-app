jest.mock('../../lib/whatsapp', () => ({
  sendText: jest.fn(),
  sendButtonMessage: jest.fn(),
  sendCtaUrlMessage: jest.fn(),
}));

const { sendCtaUrlMessage } = require('../../lib/whatsapp');
const { buildKeypadUrl, getKeypadBaseUrl, KEYPAD_KEYWORDS, sendKeypadCtaIfConfigured } = require('../keypadLink');

describe('keypadLink', () => {
  const orig = process.env.KEYPAD_BASE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    sendCtaUrlMessage.mockResolvedValue('msg_cta');
  });

  afterEach(() => {
    if (orig === undefined) delete process.env.KEYPAD_BASE_URL;
    else process.env.KEYPAD_BASE_URL = orig;
  });

  test('buildKeypadUrl includes business, customer, lang', () => {
    process.env.KEYPAD_BASE_URL = 'http://192.168.0.60:5173';
    const url = buildKeypadUrl('biz1', '+436601234567', 'de');
    expect(url).toBe('http://192.168.0.60:5173/keypad/biz1?lang=de&customer=436601234567');
  });

  test('returns null when KEYPAD_BASE_URL unset', () => {
    delete process.env.KEYPAD_BASE_URL;
    expect(buildKeypadUrl('biz1', '43660', 'en')).toBeNull();
    expect(getKeypadBaseUrl()).toBe('');
  });

  test('sendKeypadCtaIfConfigured sends CTA URL message', async () => {
    process.env.KEYPAD_BASE_URL = 'http://localhost:5173';
    const ok = await sendKeypadCtaIfConfigured('43660111', 'en', 'biz1');
    expect(ok).toBe(true);
    expect(sendCtaUrlMessage).toHaveBeenCalledWith('43660111', expect.objectContaining({
      url: expect.stringContaining('/keypad/biz1'),
      buttonLabel: expect.any(String),
    }));
  });

  test('KEYPAD_KEYWORDS includes keypad and tastatur', () => {
    expect(KEYPAD_KEYWORDS.has('keypad')).toBe(true);
    expect(KEYPAD_KEYWORDS.has('tastatur')).toBe(true);
  });
});
