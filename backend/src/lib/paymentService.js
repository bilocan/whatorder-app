const { ordersRef, stripeEventRef } = require('./collections');
const { admin } = require('./firebase');
const { getStripe } = require('./stripe');
const { getFeeConfig, calcFeeCents } = require('./feeConfig');
const { getSettlementConfig, computeHoldEndsAt, computeExpectedPayoutAt } = require('./settlementConfig');
const { resolveWhatsAppReturnPhoneDigits, waMeUrl, resolvePaymentLang } = require('./whatsappReturn');
const { resolvePhoneNumberIdForOrder, formatOrderWhatsAppSendError } = require('./whatsappRouting');
const { sendText, sendButtonMessage } = require('./whatsapp');
const { t } = require('./templates');

function paymentBaseUrl() {
  const url = process.env.BACKEND_URL?.replace(/\/$/, '');
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BACKEND_URL must be set on Cloud Run for Stripe payment redirects');
  }
  return 'http://localhost:3000';
}

async function createCheckoutSessionForOrder(businessId, orderId, { totalEuros, restaurantName, shortId, lang = 'en' }) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  const amountCents = Math.round(totalEuros * 100);
  if (amountCents < 50) throw new Error('Order total too low for card payment');

  const base = paymentBaseUrl();
  const waDigits = await resolveWhatsAppReturnPhoneDigits();
  const waQuery = waDigits ? `&wa=${encodeURIComponent(waDigits)}` : '';
  const langQuery = `&lang=${encodeURIComponent(resolvePaymentLang(lang))}`;
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
    success_url: `${base}/payments/success?session_id={CHECKOUT_SESSION_ID}${waQuery}${langQuery}`,
    cancel_url: `${base}/payments/cancel?session_id={CHECKOUT_SESSION_ID}${waQuery}${langQuery}`,
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
  const settlementConfig = await getSettlementConfig();
  const whatorderFeeCents = calcFeeCents(grossAmountCents, feeConfig);
  const restaurantNetCents = Math.max(0, grossAmountCents - whatorderFeeCents);
  const holdEndsAt = computeHoldEndsAt(new Date(), settlementConfig);
  const settlementEligibleAt = holdEndsAt.toISOString();
  const expectedPayoutAt = computeExpectedPayoutAt(holdEndsAt, settlementConfig).toISOString();

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
      settlementEligibleAt,
      expectedPayoutAt,
    });
  }

  try {
    const phoneNumberId = resolvePhoneNumberIdForOrder(order, businessId, orderId);
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    await sendText(order.customerPhone, t('paymentConfirmed', lang, shortId), phoneNumberId);
    await orderRef.update({
      paymentNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Best-effort: send post-order action buttons. Failure is logged but does not
    // block the primary notification or cause a duplicate text on retry.
    await sendButtonMessage(order.customerPhone, {
      body: t('postOrderOptions', lang, order.restaurantName || null),
      buttons: [
        { id: 'btn_post_cancel',     title: t('postCancelBtn', lang) },
        { id: 'btn_post_reorder',    title: t('postReorderBtn', lang) },
        { id: 'btn_post_restaurant', title: t('postRestaurantBtn', lang) },
      ],
    }, phoneNumberId);
  } catch (err) {
    const msg = err.name === 'WhatsAppRoutingError'
      ? err.message
      : formatOrderWhatsAppSendError(err, { orderId, businessId, phoneNumberId: order.whatsappPhoneNumberId, kind: 'Payment confirmation' });
    console.error(`[stripe] ${msg}`);
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
