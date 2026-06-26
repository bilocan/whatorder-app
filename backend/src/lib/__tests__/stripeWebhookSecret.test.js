const fs = require('fs');

const { resolveStripeWebhookSecret, LISTEN_SECRET_FILE } = require('../stripeWebhookSecret');

describe('resolveStripeWebhookSecret', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    try {
      if (fs.existsSync(LISTEN_SECRET_FILE)) fs.unlinkSync(LISTEN_SECRET_FILE);
    } catch (_) {}
  });

  test('production uses STRIPE_WEBHOOK_SECRET env only', () => {
    process.env = { ...originalEnv, NODE_ENV: 'production', STRIPE_WEBHOOK_SECRET: 'whsec_prod' };
    expect(resolveStripeWebhookSecret()).toBe('whsec_prod');
  });

  test('development prefers stripe listen secret file over env', () => {
    process.env = { ...originalEnv, NODE_ENV: 'development', STRIPE_WEBHOOK_SECRET: 'whsec_dashboard' };
    fs.writeFileSync(LISTEN_SECRET_FILE, 'whsec_listen\n');
    expect(resolveStripeWebhookSecret()).toBe('whsec_listen');
  });

  test('development falls back to env when listen file missing', () => {
    process.env = { ...originalEnv, NODE_ENV: 'development', STRIPE_WEBHOOK_SECRET: 'whsec_dashboard' };
    expect(resolveStripeWebhookSecret()).toBe('whsec_dashboard');
  });
});
