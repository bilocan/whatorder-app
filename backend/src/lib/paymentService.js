const { ordersRef, stripeEventRef, businessRef } = require('./collections');
const { admin } = require('./firebase');
const { getStripe } = require('./stripe');
const { getFeeConfig, calcFeeCents } = require('./feeConfig');
const { getSettlementConfig, computeHoldEndsAt, computeExpectedPayoutAt } = require('./settlementConfig');
const { resolveWhatsAppReturnPhoneDigits, waMeUrl, resolvePaymentLang } = require('./whatsappReturn');
const { resolvePhoneNumberIdForOrder, formatOrderWhatsAppSendError } = require('./whatsappRouting');
const { sendText, sendButtonMessage, uploadMedia, sendDocument } = require('./whatsapp');
const { runWithMessageIdentity, applyBusinessInfoIdentity, PLATFORM_IDENTITY } = require('./messageIdentity');
const { t } = require('./templates');
const { isLegalComplete, isSettlementIbanComplete } = require('./legalProfile');
const { issueCustomerBeleg } = require('./receiptService');

const LEGAL_PROFILE_INCOMPLETE = 'LEGAL_PROFILE_INCOMPLETE';
const SETTLEMENT_IBAN_INCOMPLETE = 'SETTLEMENT_IBAN_INCOMPLETE';

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

  // Defense in depth: Settings UI gates enablement; never charge without Beleg seller
  // identity or a valid settlement IBAN (payout account on file).
  const bizSnap = await businessRef(businessId).get();
  const legal = bizSnap.exists ? bizSnap.data()?.legal : null;
  if (!isLegalComplete(legal)) throw new Error(LEGAL_PROFILE_INCOMPLETE);
  if (!isSettlementIbanComplete(legal)) throw new Error(SETTLEMENT_IBAN_INCOMPLETE);

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

  // Best-effort Beleg: never roll back paid status on PDF/GCS failure.
  let beleg = null;
  try {
    beleg = await issueCustomerBeleg(businessId, orderId, session);
  } catch (err) {
    console.error(`[stripe] Beleg issue failed businessId=${businessId} orderId=${orderId}: ${err.message}`);
  }

  if (order.paymentNotifiedAt) return;

  try {
    const phoneNumberId = resolvePhoneNumberIdForOrder(order, businessId, orderId);
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    const bizSnap = await businessRef(businessId).get();
    await runWithMessageIdentity(PLATFORM_IDENTITY, async () => {
      applyBusinessInfoIdentity(bizSnap.exists ? bizSnap.data() : { name: order.restaurantName });
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

      if (beleg?.status === 'ready' && beleg.gcsPath) {
        try {
          const { downloadReceiptPdf } = require('./receipts/gcsReceiptStorage');
          const pdfBuffer = await downloadReceiptPdf(beleg.gcsPath);
          const filename = `${beleg.belegNumber}.pdf`;
          const mediaId = await uploadMedia(pdfBuffer, {
            mimeType: 'application/pdf',
            filename,
            phoneNumberId,
          });
          await sendDocument(order.customerPhone, {
            mediaId,
            filename,
            caption: t('paymentBelegCaption', lang, beleg.belegNumber),
          }, phoneNumberId);
          const { receiptRef } = require('./collections');
          await receiptRef(businessId, beleg.receiptId).set({ whatsappMediaId: mediaId }, { merge: true });
        } catch (docErr) {
          console.error(`[stripe] Beleg WhatsApp document failed orderId=${orderId}: ${docErr.message}`);
        }
      }
    });
  } catch (err) {
    const msg = err.name === 'WhatsAppRoutingError'
      ? err.message
      : formatOrderWhatsAppSendError(err, { orderId, businessId, phoneNumberId: order.whatsappPhoneNumberId, kind: 'Payment confirmation' });
    console.error(`[stripe] ${msg}`);
  }
}

function orderShortId(orderId) {
  return String(orderId || '').slice(-6).toUpperCase();
}

/**
 * Persist refunded payment/settlement fields. Optionally notify the customer once.
 * @returns {{ applied: boolean, notified: boolean }}
 */
async function applyOrderRefunded(businessId, orderId, {
  refundId = null,
  reason = null,
  actor = null,
  notifyCustomer = false,
} = {}) {
  const orderRef = ordersRef(businessId).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    console.error('[stripe] refund apply: order not found', businessId, orderId);
    return { applied: false, notified: false };
  }

  const order = orderSnap.data();
  const alreadyRefunded = order.paymentStatus === 'refunded';
  if (!alreadyRefunded) {
    const update = {
      paymentStatus: 'refunded',
      settlementStatus: 'refunded',
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (refundId) update.stripeRefundId = refundId;
    if (reason) update.refundReason = reason;
    if (actor) update.refundActor = actor;
    await orderRef.update(update);
  }

  let notified = false;
  if (notifyCustomer && !order.refundNotifiedAt) {
    try {
      const phoneNumberId = resolvePhoneNumberIdForOrder(order, businessId, orderId);
      const lang = order.language || 'en';
      const shortId = orderShortId(orderId);
      const bizSnap = await businessRef(businessId).get();
      await runWithMessageIdentity(PLATFORM_IDENTITY, async () => {
        applyBusinessInfoIdentity(bizSnap.exists ? bizSnap.data() : { name: order.restaurantName });
        await sendText(order.customerPhone, t('paymentRefunded', lang, shortId), phoneNumberId);
        await orderRef.update({
          refundNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      notified = true;
    } catch (err) {
      const msg = err.name === 'WhatsAppRoutingError'
        ? err.message
        : formatOrderWhatsAppSendError(err, {
          orderId,
          businessId,
          phoneNumberId: order.whatsappPhoneNumberId,
          kind: 'Refund notification',
        });
      console.error(`[stripe] ${msg}`);
    }
  }

  return { applied: !alreadyRefunded, notified };
}

/**
 * Full Stripe refund for a paid card order. Cash / unpaid / already-refunded → no-op.
 * Idempotent via Stripe idempotency key `wo_refund_${orderId}`.
 *
 * @param {string} businessId
 * @param {string} orderId
 * @param {{ reason?: string, actor?: string, notifyCustomer?: boolean }} [options]
 * @returns {Promise<{ refunded: boolean, skipped: boolean, reason?: string, refundId?: string }>}
 */
async function refundOrderPayment(businessId, orderId, {
  reason = 'requested',
  actor = 'system',
  notifyCustomer = true,
} = {}) {
  const orderRef = ordersRef(businessId).doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error('Order not found');

  const order = orderSnap.data();

  if (order.paymentStatus === 'refunded') {
    return { refunded: true, skipped: true, reason: 'already_refunded', refundId: order.stripeRefundId || undefined };
  }

  if (order.paymentMethod !== 'stripe' || order.paymentStatus !== 'paid') {
    return { refunded: false, skipped: true, reason: 'not_paid_stripe' };
  }

  if (!order.stripePaymentIntentId) {
    throw new Error('Missing stripePaymentIntentId for refund');
  }

  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      metadata: {
        business_id: businessId,
        order_id: orderId,
        reason,
        actor,
      },
    }, {
      idempotencyKey: `wo_refund_${orderId}`,
    });
  } catch (err) {
    // Stripe may reject a second create if the charge is already fully refunded outside our key.
    if (err?.code === 'charge_already_refunded') {
      await applyOrderRefunded(businessId, orderId, {
        refundId: order.stripeRefundId || null,
        reason,
        actor,
        notifyCustomer,
      });
      return { refunded: true, skipped: true, reason: 'already_refunded_stripe' };
    }
    throw err;
  }

  await applyOrderRefunded(businessId, orderId, {
    refundId: refund.id,
    reason,
    actor,
    notifyCustomer,
  });

  return { refunded: true, skipped: false, refundId: refund.id };
}

async function handleChargeRefunded(charge) {
  const refunds = Array.isArray(charge.refunds?.data) ? charge.refunds.data : [];
  const refund = refunds[0] || null;
  const businessId = refund?.metadata?.business_id || charge.metadata?.business_id;
  const orderId = refund?.metadata?.order_id || charge.metadata?.order_id;
  if (!businessId || !orderId) {
    console.error('[stripe] charge.refunded missing business_id/order_id metadata', charge.id);
    return;
  }

  await applyOrderRefunded(businessId, orderId, {
    refundId: refund?.id || null,
    reason: refund?.metadata?.reason || 'stripe_webhook',
    actor: refund?.metadata?.actor || 'webhook',
    // Only notifies if cancel/reject path did not already mark refundNotifiedAt.
    notifyCustomer: true,
  });
}

async function processStripeWebhookEvent(event) {
  if (await isStripeEventProcessed(event.id)) return { duplicate: true };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      await handleCheckoutSessionCompleted(session);
    }
  } else if (event.type === 'charge.refunded') {
    await handleChargeRefunded(event.data.object);
  }

  await markStripeEventProcessed(event.id, event.type);
  return { duplicate: false };
}

module.exports = {
  LEGAL_PROFILE_INCOMPLETE,
  SETTLEMENT_IBAN_INCOMPLETE,
  createCheckoutSessionForOrder,
  handleCheckoutSessionCompleted,
  refundOrderPayment,
  applyOrderRefunded,
  handleChargeRefunded,
  processStripeWebhookEvent,
  paymentBaseUrl,
};
