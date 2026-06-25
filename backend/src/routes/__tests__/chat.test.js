jest.mock('../../lib/whatsappReturn', () => {
  const actual = jest.requireActual('../../lib/whatsappReturn');
  return {
    ...actual,
    resolveWhatsAppReturnPhoneDigits: jest.fn(),
  };
});

const request = require('supertest');
const { resolveWhatsAppReturnPhoneDigits } = require('../../lib/whatsappReturn');

describe('GET /chat', () => {
  const originalPrefill = process.env.WHATSAPP_CHAT_PREFILL;
  const app = require('../../index');

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WHATSAPP_CHAT_PREFILL;
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env.WHATSAPP_CHAT_PREFILL = originalPrefill;
  });

  test('redirects to wa.me with prefill when phone is resolved', async () => {
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue('436601234567');
    const res = await request(app).get('/chat');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://wa.me/436601234567?text=Hallo');
  });

  test('uses custom prefill when WHATSAPP_CHAT_PREFILL is set', async () => {
    process.env.WHATSAPP_CHAT_PREFILL = 'Bestellen';
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue('436601234567');
    const res = await request(app).get('/chat');
    expect(res.headers.location).toBe('https://wa.me/436601234567?text=Bestellen');
  });

  test('?wa= overrides resolved phone', async () => {
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue('436601111111');
    const res = await request(app).get('/chat?wa=436609999999');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://wa.me/436609999999?text=Hallo');
    expect(resolveWhatsAppReturnPhoneDigits).not.toHaveBeenCalled();
  });

  test('?text= overrides default prefill', async () => {
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue('436601234567');
    const res = await request(app).get('/chat?text=Bestellen');
    expect(res.headers.location).toBe('https://wa.me/436601234567?text=Bestellen');
  });

  test('?wa= and ?text= combine for restaurant marketing QR', async () => {
    const res = await request(app).get('/chat?wa=436609999999&text=Bestellen');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://wa.me/436609999999?text=Bestellen');
    expect(resolveWhatsAppReturnPhoneDigits).not.toHaveBeenCalled();
  });

  test('?bid= embeds ORDER deep link for shared multitenant number', async () => {
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue('436601234567');
    const res = await request(app).get('/chat?bid=biz_hamat_abc');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://wa.me/436601234567?text=ORDER%20biz_hamat_abc');
  });

  test('returns 503 HTML when no phone is configured', async () => {
    const res = await request(app).get('/chat');
    expect(res.status).toBe(503);
    expect(res.text).toContain('nicht verfügbar');
  });

  test('?html=1 returns redirect page instead of 302', async () => {
    resolveWhatsAppReturnPhoneDigits.mockResolvedValue('436601234567');
    const res = await request(app).get('/chat?html=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://wa.me/436601234567?text=Hallo');
    expect(res.text).toContain('Weiter zu WhatsApp');
  });
});
