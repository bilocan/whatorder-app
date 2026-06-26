const fs = require('fs');
const path = require('path');

const LISTEN_SECRET_FILE = path.join(__dirname, '../../.stripe-listen-secret');

function readListenSecretFile() {
  try {
    if (!fs.existsSync(LISTEN_SECRET_FILE)) return null;
    const secret = fs.readFileSync(LISTEN_SECRET_FILE, 'utf8').trim();
    return secret.startsWith('whsec_') ? secret : null;
  } catch {
    return null;
  }
}

/** Production: STRIPE_WEBHOOK_SECRET env only. Local dev: prefer stripe listen file over env. */
function resolveStripeWebhookSecret() {
  if (process.env.NODE_ENV === 'production') {
    return process.env.STRIPE_WEBHOOK_SECRET || null;
  }
  return readListenSecretFile() || process.env.STRIPE_WEBHOOK_SECRET || null;
}

module.exports = { resolveStripeWebhookSecret, readListenSecretFile, LISTEN_SECRET_FILE };
