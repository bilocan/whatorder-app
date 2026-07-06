const crypto = require('crypto');

/**
 * Verify Meta webhook X-Hub-Signature-256 (HMAC-SHA256 of raw body with app secret).
 * @see whatsapp-business-api-reference.md Section 9
 */
function verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !rawBody || !signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  if (signatureHeader.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

function isWebhookSignatureConfigured() {
  return Boolean(process.env.WHATSAPP_APP_SECRET?.trim());
}

/**
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
function assertWebhookSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, status: 503, message: 'Webhook signature not configured' };
    }
    return { ok: true };
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return { ok: false, status: 401, message: 'Missing X-Hub-Signature-256' };
  }

  if (!verifyMetaWebhookSignature(req.rawBody, signature, secret)) {
    return { ok: false, status: 401, message: 'Invalid signature' };
  }

  return { ok: true };
}

module.exports = {
  verifyMetaWebhookSignature,
  isWebhookSignatureConfigured,
  assertWebhookSignature,
};
