const { FIELDS: F } = require('../flows/fields');
const { formatBasketItemsText } = require('./botHelpers');
const { basketSubtotal, orderTotals } = require('./orderTotals');
const { isDeliveryOffered } = require('./checkoutSlots');
const { isPaymentEnabled } = require('./paymentGate');

const CHECKOUT_TOKEN_MARKER = 'checkout';
const ORDER_TYPES = new Set(['delivery', 'pickup']);

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildReceiptText({
  session = {},
  basket = [],
  businessName,
  total,
  lang,
  t,
  paymentEnabled = false,
}) {
  const name = trimmed(session.customerName);
  const address = session.orderType === 'pickup'
    ? null
    : (trimmed(session.deliveryAddress) || null);
  const notes = trimmed(session.specialRequests) || null;
  const formattedTotal = Number(total || 0).toFixed(2);
  const summary = t(
    'finalConfirmBody',
    lang,
    name,
    formattedTotal,
    session.pickupTime,
    address,
    notes,
    paymentEnabled ? 'stripe' : null,
  );
  const items = formatBasketItemsText(basket, { numbered: false, mergeIdentical: true });

  return [trimmed(businessName), summary, items].filter(Boolean).join('\n\n');
}

/**
 * Delivery is offered on the confirm screen only when the same gates that guard the
 * place path would pass: delivery enabled, not paused by the owner, and the basket at
 * or above minimumOrderValue. Slice 1 has no data_exchange refresh, so a pickup → delivery
 * switch inside the Flow cannot re-price or re-gate; omitting the option when it would
 * fail keeps the shown total honest and avoids a dead end after submit.
 */
function isDeliverySelectableInReview(info = {}, basket = []) {
  if (!isDeliveryOffered(info)) return false;
  if (info.deliveryOpen === false) return false;
  if (info.minimumOrderValue && basketSubtotal(basket) < info.minimumOrderValue) return false;
  return true;
}

/** Partial values kept across a failed submit so the reopened Flow does not lose typed edits. */
function buildConfirmFlowDraft(payload = {}) {
  const draft = {};
  if (F.CUSTOMER_NAME in payload) draft.customerName = trimmed(payload[F.CUSTOMER_NAME]);
  if (F.ORDER_TYPE in payload && ORDER_TYPES.has(payload[F.ORDER_TYPE])) {
    draft.orderType = payload[F.ORDER_TYPE];
  }
  if (F.DELIVERY_ADDRESS in payload) draft.deliveryAddress = trimmed(payload[F.DELIVERY_ADDRESS]);
  if (F.CHECKOUT_NOTE in payload) draft.specialRequests = trimmed(payload[F.CHECKOUT_NOTE]);
  return Object.keys(draft).length ? draft : null;
}

function buildCheckoutReviewData({
  session = {},
  basket = [],
  info = {},
  lang,
  t,
}) {
  const draft = session.confirmFlowDraft ?? {};
  const deliverySelectable = isDeliverySelectableInReview(info, basket);
  const requestedType = ORDER_TYPES.has(draft.orderType)
    ? draft.orderType
    : (ORDER_TYPES.has(session.orderType)
      ? session.orderType
      : (deliverySelectable ? 'delivery' : 'pickup'));
  const orderType = (requestedType === 'delivery' && !deliverySelectable) ? 'pickup' : requestedType;

  const customerName = draft.customerName ?? trimmed(session.customerName);
  const deliveryAddress = draft.deliveryAddress ?? trimmed(session.deliveryAddress);
  const specialRequests = draft.specialRequests ?? trimmed(session.specialRequests);

  const reviewSession = {
    ...session, orderType, customerName, deliveryAddress, specialRequests,
  };
  const { total } = orderTotals(basket, reviewSession, info);
  const options = [
    { id: 'pickup', title: t('confirmFlowTypePickup', lang) },
  ];
  if (deliverySelectable) {
    options.push({ id: 'delivery', title: t('confirmFlowTypeDelivery', lang) });
  }

  return {
    [F.RECEIPT_TEXT]: buildReceiptText({
      session: reviewSession,
      basket,
      businessName: info.name,
      total,
      lang,
      t,
      paymentEnabled: isPaymentEnabled(info),
    }),
    [F.CUSTOMER_NAME]: customerName,
    [F.ORDER_TYPE]: orderType,
    [F.ORDER_TYPE_OPTIONS]: options,
    [F.DELIVERY_ADDRESS]: deliveryAddress,
    [F.CHECKOUT_NOTE]: specialRequests,
  };
}

function validateCheckoutSubmit(payload = {}) {
  if (payload.checkout_action === 'back_to_cart') {
    return { ok: true, values: null };
  }

  const customerName = trimmed(payload[F.CUSTOMER_NAME]);
  if (customerName.length < 2) {
    return { ok: false, errorKey: 'confirmFlowErrorName' };
  }

  const orderType = payload[F.ORDER_TYPE];
  if (!ORDER_TYPES.has(orderType)) {
    return { ok: false, errorKey: 'confirmFlowErrorAddress' };
  }

  const deliveryAddress = trimmed(payload[F.DELIVERY_ADDRESS]);
  if (orderType === 'delivery' && !deliveryAddress) {
    return { ok: false, errorKey: 'confirmFlowErrorAddress' };
  }

  return {
    ok: true,
    values: {
      customerName,
      orderType,
      deliveryAddress: orderType === 'delivery' ? deliveryAddress : null,
      specialRequests: trimmed(payload[F.CHECKOUT_NOTE]),
    },
  };
}

function applyCheckoutSubmitToSession(session, values) {
  return {
    ...session,
    customerName: values.customerName,
    orderType: values.orderType,
    deliveryAddress: values.orderType === 'pickup' ? null : values.deliveryAddress,
    specialRequests: values.specialRequests,
    // A valid submit supersedes whatever a previous failed submit left behind.
    confirmFlowDraft: null,
  };
}

function parseCheckoutFlowToken(flowToken) {
  if (typeof flowToken !== 'string') return null;
  const parts = flowToken.split('|');
  if (parts.length !== 2 && parts.length !== 3) return null;

  const [phone, businessId, marker] = parts;
  if (!phone || !businessId) return null;
  if (parts.length === 3 && marker !== CHECKOUT_TOKEN_MARKER) return null;

  return {
    phone,
    businessId,
    isCheckout: marker === CHECKOUT_TOKEN_MARKER,
  };
}

function checkoutFlowToken(phone, businessId) {
  return `${phone}|${businessId}|${CHECKOUT_TOKEN_MARKER}`;
}

module.exports = {
  buildReceiptText,
  buildCheckoutReviewData,
  buildConfirmFlowDraft,
  isDeliverySelectableInReview,
  validateCheckoutSubmit,
  applyCheckoutSubmitToSession,
  parseCheckoutFlowToken,
  checkoutFlowToken,
};
