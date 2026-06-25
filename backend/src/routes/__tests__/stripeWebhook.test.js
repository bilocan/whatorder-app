jest.mock('../../lib/firebase', () => ({ db: {}, admin: {} }));
jest.mock('../../lib/stripe');
jest.mock('../../lib/paymentService', () => ({
  processStripeWebhookEvent: jest.fn().mockResolvedValue({ duplicate: false }),
  handleCheckoutSessionCompleted: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const { getStripe } = require('../../lib/stripe');
const { processStripeWebhookEvent, handleCheckoutSessionCompleted } = require('../../lib/paymentService');

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
      checkout: {
        sessions: {
          retrieve: jest.fn().mockResolvedValue({ id: 'cs_test', payment_status: 'paid' }),
        },
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

  test('GET /payments/success with session_id confirms payment when paid', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success?session_id=cs_test');
    expect(res.status).toBe(200);
    expect(getStripe().checkout.sessions.retrieve).toHaveBeenCalledWith('cs_test');
    expect(handleCheckoutSessionCompleted).toHaveBeenCalledWith({ id: 'cs_test', payment_status: 'paid' });
  });

  test('GET /payments/success with session_id skips confirmation when not paid', async () => {
    getStripe().checkout.sessions.retrieve.mockResolvedValue({ id: 'cs_test', payment_status: 'unpaid' });
    const app = require('../../index');
    const res = await request(app).get('/payments/success?session_id=cs_test');
    expect(res.status).toBe(200);
    expect(handleCheckoutSessionCompleted).not.toHaveBeenCalled();
  });

  test('GET /payments/success still renders when Stripe session lookup fails', async () => {
    getStripe().checkout.sessions.retrieve.mockRejectedValue(new Error('boom'));
    const app = require('../../index');
    const res = await request(app).get('/payments/success?session_id=cs_test');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Payment received');
    expect(handleCheckoutSessionCompleted).not.toHaveBeenCalled();
  });

  test('GET /payments/success without session_id does not call Stripe', async () => {
    const app = require('../../index');
    const res = await request(app).get('/payments/success');
    expect(res.status).toBe(200);
    expect(getStripe().checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(handleCheckoutSessionCompleted).not.toHaveBeenCalled();
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
