const express = require('express');
const { getStripe } = require('../lib/stripe');
const { resolveStripeWebhookSecret } = require('../lib/stripeWebhookSecret');
const { processStripeWebhookEvent, handleCheckoutSessionCompleted } = require('../lib/paymentService');
const {
  digitsOnly,
  waMeUrl,
  resolveWhatsAppReturnPhoneDigits,
  resolvePaymentLang,
  buildPaymentReturnHtml,
} = require('../lib/whatsappReturn');

const router = express.Router();

async function resolveWaDigitsFromQuery(query) {
  const fromQuery = digitsOnly(query.wa);
  if (fromQuery) return fromQuery;
  return resolveWhatsAppReturnPhoneDigits();
}

router.get('/payments/success', async (req, res) => {
  await confirmPaymentFromSessionId(req.query.session_id);
  const waDigits = await resolveWaDigitsFromQuery(req.query);
  const lang = resolvePaymentLang(req.query.lang);
  res.type('html').send(buildPaymentReturnHtml({
    variant: 'success',
    lang,
    waUrl: waMeUrl(waDigits),
    waDigits,
  }));
});

async function confirmPaymentFromSessionId(sessionId) {
  if (!sessionId) return;
  const stripe = getStripe();
  if (!stripe) return;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid') {
      await handleCheckoutSessionCompleted(session);
    }
  } catch (err) {
    console.error('[stripe] success-page fallback failed:', err.message);
  }
}

router.get('/payments/cancel', async (req, res) => {
  const waDigits = await resolveWaDigitsFromQuery(req.query);
  const lang = resolvePaymentLang(req.query.lang);
  res.type('html').send(buildPaymentReturnHtml({
    variant: 'cancel',
    lang,
    waUrl: waMeUrl(waDigits),
    waDigits,
  }));
});

router.post('/', async (req, res) => {
  const stripe = getStripe();
  const secret = resolveStripeWebhookSecret();

  if (!stripe || !secret) {
    return res.status(503).json({ error: 'Stripe webhook not configured' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, secret);
  } catch (err) {
    console.error('[stripe] webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    await processStripeWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook handler error:', err.message);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

module.exports = router;
