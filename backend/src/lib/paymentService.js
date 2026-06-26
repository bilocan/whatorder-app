const { ordersRef, stripeEventRef } = require('./collections');
const { admin } = require('./firebase');
const { getStripe } = require('./stripe');
const { getFeeConfig, calcFeeCents } = require('./feeConfig');
const { resolveWhatsAppReturnPhoneDigits, waMeUrl } = require('./whatsappReturn');
const { resolvePhoneNumberIdForOrder } = require('./whatsappRouting');
const { sendText } = require('./whatsapp');
const { t } = require('../bot/templates');

const SETTLEMENT_HOLD_DAYS = 7;

function paymentBaseUrl() {
  const url = process.env.BACKEND_URL?.replace(/\/$/, '');
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BACKEND_URL must be set on Cloud Run for Stripe payment redirects');
  }
  return 'http://localhost:3000';
}

async function createCheckoutSessionForOrder(businessId, orderId, { totalEuros, restaurantName, shortId }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  const amountCents = Math.round(totalEuros * 100);
  if (amountCents < 50) throw new Error('Order total too low for card payment');

  const base = paymentBaseUrl();
  const waDigits = await resolveWhatsAppReturnPhoneDigits();
  const waQuery = waDigits ? `&wa=${encodeURIComponent(waDigits)}` : '';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: {
          name: `Order #${shortId}`,
          description: restaurantName || 'WhatOrder',
        },
        unit_amount: amountCents,
      },
      quantity: 1,
    }],
    metadata: {
      order_id: orderId,
      business_id: businessId,
    },
    success_url: `${base}/payments/success?session_id={CHECKOUT_SESSION_ID}${waQuery}`,
    cancel_url: `${base}/payments/cancel?session_id={CHECKOUT_SESSION_ID}${waQuery}`,
  });

  return { url: session.url, sessionId: session.id };
}

async function isStripeEventProcessed(eventId) {
  const snap = await stripeEventRef(eventId).get();
  return snap.exists;
}

async function markStripeEventProcessed(eventId, type) {
  await stripeEventRef(eventId).set({
    type,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function handleCheckoutSessionCompleted(session) {
  const businessId = session.metadata?.business_id;
  const orderId = session.metadata?.order_id;
  if (!businessId || !orderId) {
    console.error('[stripe] checkout.session.completed missing metadata', session.id);
    return;
  }

  const orderRef = ordersRef(businessId).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    console.error('[stripe] order not found', businessId, orderId);
    return;
  }

  const order = orderSnap.data();
  if (order.paymentNotifiedAt) return;

  const alreadyPaid = order.paymentStatus === 'paid';
  const grossAmountCents = session.amount_total ?? Math.round((order.total || 0) * 100);
  const feeConfig = await getFeeConfig();
  const whatorderFeeCents = calcFeeCents(grossAmountCents, feeConfig);
  const restaurantNetCents = Math.max(0, grossAmountCents - whatorderFeeCents);
  const settlementEligibleAt = new Date(Date.now() + SETTLEMENT_HOLD_DAYS * 24 * 60 * 60 * 1000);

  if (!alreadyPaid) {
    await orderRef.update({
      paymentStatus: 'paid',
      paymentMethod: 'stripe',
      paymentStripeSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
      grossAmountCents,
      whatorderFeeCents,
      restaurantNetCents,
      paymentProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      settlementStatus: 'pending',
      settlementEligibleAt: settlementEligibleAt.toISOString(),
    });
  }

  try {
    const phoneNumberId = await resolvePhoneNumberIdForOrder(order, businessId);
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    await sendText(order.customerPhone, t('paymentConfirmed', lang, shortId), phoneNumberId);
    await orderRef.update({
      paymentNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[stripe] customer payment confirmation failed:', err.message);
  }
}

async function processStripeWebhookEvent(event) {
  if (await isStripeEventProcessed(event.id)) return { duplicate: true };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      await handleCheckoutSessionCompleted(session);
    }
  }

  await markStripeEventProcessed(event.id, event.type);
  return { duplicate: false };
}

module.exports = {
  createCheckoutSessionForOrder,
  handleCheckoutSessionCompleted,
  processStripeWebhookEvent,
  paymentBaseUrl,
};
