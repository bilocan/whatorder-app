const crypto = require('crypto');
const {
  verifyMetaWebhookSignature,
  assertWebhookSignature,
} = require('../whatsappWebhookSecurity');

describe('verifyMetaWebhookSignature', () => {
  const secret = 'test_app_secret';
  const body = Buffer.from('{"entry":[]}');
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

  test('accepts valid signature', () => {
    expect(verifyMetaWebhookSignature(body, signature, secret)).toBe(true);
  });

  test('rejects wrong secret', () => {
    expect(verifyMetaWebhookSignature(body, signature, 'wrong')).toBe(false);
  });

  test('rejects tampered body', () => {
    expect(verifyMetaWebhookSignature(Buffer.from('{}'), signature, secret)).toBe(false);
  });
});

describe('assertWebhookSignature', () => {
  const secret = 'test_app_secret';
  const body = Buffer.from('{"ok":true}');
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.NODE_ENV;
  });

  test('skips verification in non-production when secret unset', () => {
    process.env.NODE_ENV = 'test';
    expect(assertWebhookSignature({ headers: {}, rawBody: body }).ok).toBe(true);
  });

  test('rejects in production when secret unset', () => {
    process.env.NODE_ENV = 'production';
    const result = assertWebhookSignature({ headers: {}, rawBody: body });
    expect(result).toEqual({ ok: false, status: 503, message: 'Webhook signature not configured' });
  });

  test('rejects missing header when secret set', () => {
    process.env.WHATSAPP_APP_SECRET = secret;
    const result = assertWebhookSignature({ headers: {}, rawBody: body });
    expect(result).toEqual({ ok: false, status: 401, message: 'Missing X-Hub-Signature-256' });
  });

  test('accepts valid header when secret set', () => {
    process.env.WHATSAPP_APP_SECRET = secret;
    const result = assertWebhookSignature({
      headers: { 'x-hub-signature-256': signature },
      rawBody: body,
    });
    expect(result).toEqual({ ok: true });
  });
});
