const express = require('express');
const { getStripe } = require('../lib/stripe');
const { processStripeWebhookEvent } = require('../lib/paymentService');
const {
  digitsOnly,
  waMeUrl,
  resolveWhatsAppReturnPhoneDigits,
  buildPaymentReturnHtml,
} = require('../lib/whatsappReturn');

const router = express.Router();

async function resolveWaUrlFromQuery(query) {
  const fromQuery = digitsOnly(query.wa);
  if (fromQuery) return waMeUrl(fromQuery);
  const resolved = await resolveWhatsAppReturnPhoneDigits();
  return waMeUrl(resolved);
}

router.get('/payments/success', async (req, res) => {
  const waUrl = await resolveWaUrlFromQuery(req.query);
  res.type('html').send(buildPaymentReturnHtml({
    title: 'Payment received',
    body: 'You can close this page and return to WhatsApp.',
    waUrl,
  }));
});

router.get('/payments/cancel', async (req, res) => {
  const waUrl = await resolveWaUrlFromQuery(req.query);
  res.type('html').send(buildPaymentReturnHtml({
    title: 'Payment cancelled',
    body: 'Return to WhatsApp to retry or choose cash on pickup.',
    waUrl,
  }));
});

router.post('/', async (req, res) => {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

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
