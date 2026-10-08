jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/stripe');
jest.mock('../../lib/paymentService', () => ({
  processStripeWebhookEvent: jest.fn().mockResolvedValue({ duplicate: false }),
  completePaidCheckoutSession: jest.fn().mockResolvedValue(true),
}));

const request = require('supertest');
const { getStripe } = require('../../lib/stripe');
const { processStripeWebhookEvent, completePaidCheckoutSession } = require('../../lib/paymentService');

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
      checkout: { sessions: { retrieve: jest.fn() } },
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
    expect(res.text).toContain('whatsapp://send?phone=436601234567');
    expect(res.text).toContain('Return to WhatsApp');
  });

  test('GET /payments/success with lang=de renders German copy', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success?wa=436601234567&lang=de');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Zahlung erhalten');
    expect(res.text).toContain('Zu WhatsApp zurück');
  });

  test('GET /payments/success with session_id confirms via the paid checkout path', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success?session_id=cs_test');
    expect(res.status).toBe(200);
    expect(completePaidCheckoutSession).toHaveBeenCalledWith('cs_test');
  });

  test('GET /payments/success still renders when confirmation throws', async () => {
    completePaidCheckoutSession.mockRejectedValue(new Error('boom'));
    const app = require('../../index');
    const res = await request(app).get('/payments/success?session_id=cs_test');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Payment received');
  });

  test('GET /payments/success without session_id does not confirm', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success');
    expect(res.status).toBe(200);
    expect(completePaidCheckoutSession).not.toHaveBeenCalled();
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
