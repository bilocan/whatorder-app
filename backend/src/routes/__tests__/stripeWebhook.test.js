jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/stripe');
jest.mock('../../lib/paymentService', () => ({
  processStripeWebhookEvent: jest.fn().mockResolvedValue({ duplicate: false }),
}));

const request = require('supertest');
const { getStripe } = require('../../lib/stripe');
const { processStripeWebhookEvent } = require('../../lib/paymentService');

describe('Stripe webhook route', () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    getStripe.mockReturnValue({
      webhooks: {
        constructEvent: jest.fn((body, sig, secret) => {
          if (sig !== 'valid') throw new Error('bad sig');
          return JSON.parse(body.toString());
        }),
      },
    });
  });

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  test('GET /payments/success returns HTML', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Payment received');
  });

  test('GET /payments/success with wa param redirects to WhatsApp', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success?wa=436601234567');
    expect(res.status).toBe(200);
    expect(res.text).toContain('https://wa.me/436601234567');
    expect(res.text).toContain('Returning to WhatsApp');
  });

  test('POST /webhooks/stripe with invalid signature → 400', async () => {
    const app = require('../../index');
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'invalid')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }));
    expect(res.status).toBe(400);
  });

  test('POST /webhooks/stripe with valid signature → 200', async () => {
    const app = require('../../index');
    const payload = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { payment_status: 'paid' } } };
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'valid')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
    expect(res.status).toBe(200);
    expect(processStripeWebhookEvent).toHaveBeenCalledWith(payload);
  });

  test('POST /webhooks/stripe without signature → 400', async () => {
    const app = require('../../index');
    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res.status).toBe(400);
  });
});
