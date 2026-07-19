const { patchSession } = require('./sessionStore');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { getBusinessInfo } = require('./menuService');
const { startRestaurantBrowsing } = require('./reorder');
const { looksLikeOrderText } = require('./intentParser');
const { isConversationalBasket } = require('./featureFlags');
const { detectOrderStatusQuestion } = require('./orderStatusDetect');
const {
  getOrder,
  cancelOrder,
  getLastOrderForCustomer,
} = require('./orderService');

const POST_ORDER_CONTEXT_MS = 60 * 60 * 1000;
const HANDOFF_FAILURE_THRESHOLD = 2;
const HANDOFF_BUTTON_ID = 'btn_human_handoff';

const CANCEL_ORDER_PHRASES = new Set([
  'stornieren', 'storno', 'cancel order', 'bestellung stornieren', 'bestellung abbrechen',
  'siparis iptal', 'siparisi iptal', 'iptal et', 'iptal', 'cancel my order',
]);

const CANCEL_ORDER_RE = /\b(stornier(?:en|e)?|cancel(?:\s+(?:my\s+)?order)?|bestellung\s+(?:stornieren|abbrechen)|siparis(?:i)?\s+iptal)\b/i;

const POST_ORDER_CLEAR_PATCH = {
  pendingAmendOrderId: undefined,
  pendingAmendBusinessId: undefined,
  pendingAmendPlacedAt: undefined,
};

function detectCancelOrderRequest(text, norm) {
  const n = (norm ?? (text ?? '').trim().toLowerCase()).trim();
  if (CANCEL_ORDER_PHRASES.has(n)) return true;
  return CANCEL_ORDER_RE.test(text ?? '');
}

function looksLikePostOrderModify(text, norm) {
  return detectCancelOrderRequest(text, norm) || looksLikeOrderText(text, norm);
}

// Customer can self-serve cancel only before the owner starts preparing.
function canCustomerCancel(order) {
  return order.status === 'pending' || order.status === 'approved';
}

function isCashOrder(order) {
  return order.paymentMethod !== 'stripe';
}

function isPostOrderContextExpired(placedAtMs) {
  if (!placedAtMs) return true;
  return Date.now() - placedAtMs > POST_ORDER_CONTEXT_MS;
}

function orderShortId(orderId) {
  return orderId.slice(-6).toUpperCase();
}

function buildStatusReply(order, lang) {
  const shortId = orderShortId(order.id);
  switch (order.status) {
    case 'pending':
      return t('orderStatusPending', lang, shortId);
    case 'approved':
      return t('orderApproved', lang, shortId, order.pickupTime ?? '—');
    case 'preparing':
      return t('orderPreparing', lang, shortId);
    case 'ready':
      return t('orderReady', lang, shortId);
    case 'on_the_way':
      return t('orderOnTheWay', lang, shortId);
    case 'picked_up':
      return t('orderPickedUp', lang, shortId);
    case 'delivered':
      return t('orderDelivered', lang, shortId);
    case 'cancelled':
      return t('orderCancelled', lang, shortId);
    case 'rejected':
      return t('orderRejected', lang, shortId);
    default:
      return t('orderStatusPending', lang, shortId);
  }
}

async function resolveRecentOrder(businessId, customerPhone, session) {
  if (session.pendingAmendOrderId) {
    const order = await getOrder(businessId, session.pendingAmendOrderId);
    if (order) return order;
  }
  const last = await getLastOrderForCustomer(businessId, customerPhone);
  if (!last) return null;
  return { ...last, id: last.id };
}

async function sendCallRestaurantReply({ from, lang, businessId, phoneNumberId }) {
  const info = await getBusinessInfo(businessId);
  const phone = info.alertPhone || info.phone || null;
  await sendText(from, t('postOrderCallRestaurant', lang, info.name, phone), phoneNumberId);
}

async function clearPostOrderSession(from, session, extra = {}) {
  await patchSession(from, { ...POST_ORDER_CLEAR_PATCH, ...extra }, session);
}

async function notifyOwnerHandoff({ businessId, order, customerPhone, customerName, lastMessage, session, phoneNumberId }) {
  try {
    const info = await getBusinessInfo(businessId);
    if (!info?.alertPhone) return;
    const ownerMsg = [
      '🔔 Customer needs help',
      '',
      `Customer: ${customerName || 'WhatsApp Customer'} (${customerPhone})`,
      `State: ${session.state ?? 'browsing'}`,
      order ? `Last order: #${orderShortId(order.id)} (${order.status})` : 'Last order: none',
      `Message: "${(lastMessage ?? '').slice(0, 200)}"`,
    ].join('\n');
    await sendText(info.alertPhone, ownerMsg, phoneNumberId);
  } catch (err) {
    console.error('[postOrder] owner handoff notify failed:', err.message);
  }
}

async function tryReplyOrderStatus({ from, session, lang, businessId, text }) {
  if (!detectOrderStatusQuestion(text)) return false;
  const order = await resolveRecentOrder(businessId, from, session);
  if (!order?.id) return false;
  const phoneNumberId = session.whatsappPhoneNumberId || null;
  await sendText(from, buildStatusReply(order, lang), phoneNumberId);
  return true;
}

// Handles the "Stornieren" button tap and text-based cancel ("stornieren", "iptal" etc.)
async function handlePostOrderCancelButton({ from, session, lang, businessId }) {
  const phoneNumberId = session.whatsappPhoneNumberId || null;

  if (!session.pendingAmendOrderId) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  const order = await getOrder(businessId, session.pendingAmendOrderId);
  if (!order) {
    await clearPostOrderSession(from, session);
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  // Stripe orders need a refund — hand off to restaurant.
  if (!isCashOrder(order)) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  if (canCustomerCancel(order)) {
    // skipReentry: this path restarts browsing below — avoid a second button bubble.
    await cancelOrder(businessId, order.id, { skipReentry: true });
    // transitionOrder already sends orderCancelled template to the customer.
    await clearPostOrderSession(from, session, { consecutiveParseFailures: 0 });
    const info = await getBusinessInfo(businessId);
    await startRestaurantBrowsing({
      from,
      session: { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [], whatsappPhoneNumberId: phoneNumberId },
      lang,
      businessId,
      type: 'button_reply',
      text: undefined,
      norm: '',
      businessName: info.name,
    });
    return true;
  }

  // Order is already preparing or later — too late for self-serve cancel.
  const info = await getBusinessInfo(businessId);
  const phone = info.alertPhone || info.phone || null;
  await sendText(from, t('postOrderCancelTooLate', lang, info.name, phone), phoneNumberId);
  return true;
}

async function tryHandlePostOrderMessage({
  from, session, lang, businessId, text, norm, contactName,
}) {
  if (!session.pendingAmendOrderId) return false;
  if (!looksLikePostOrderModify(text, norm)) return false;

  const placedAtMs = session.pendingAmendPlacedAt ?? null;
  const isCancelRequest = detectCancelOrderRequest(text, norm);

  // Stale context (> 1 hour): treat order text as a new order, not post-order.
  if (!isCancelRequest && isPostOrderContextExpired(placedAtMs)) {
    await clearPostOrderSession(from, session);
    return false;
  }

  if (isCancelRequest) {
    return handlePostOrderCancelButton({ from, session, lang, businessId });
  }

  // Order text after placement (not a cancel) → call restaurant.
  const phoneNumberId = session.whatsappPhoneNumberId || null;
  await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
  return true;
}

async function recordParseFailure({ from, session, lang, businessId, text, contactName }) {
  const { sendButtonMessage } = require('../lib/whatsapp');
  const info = await getBusinessInfo(businessId);
  if (!isConversationalBasket(info)) return false;

  const failures = (session.consecutiveParseFailures ?? 0) + 1;
  await patchSession(from, { consecutiveParseFailures: failures }, session);

  if (failures < HANDOFF_FAILURE_THRESHOLD) return false;

  const phoneNumberId = session.whatsappPhoneNumberId || null;
  await sendButtonMessage(from, {
    body: t('humanHandoffOffer', lang),
    buttons: [{ id: HANDOFF_BUTTON_ID, title: t('humanHandoffBtn', lang) }],
  }, phoneNumberId);

  const order = await resolveRecentOrder(businessId, from, session);
  await notifyOwnerHandoff({
    businessId,
    order,
    customerPhone: from,
    customerName: session.customerName || contactName,
    lastMessage: text,
    session,
    phoneNumberId,
  });
  return true;
}

async function resetParseFailures(from, session) {
  if (!session.consecutiveParseFailures) return;
  await patchSession(from, { consecutiveParseFailures: 0 }, session);
}

async function handleHumanHandoffButton({ from, session, lang, businessId, contactName, text }) {
  const phoneNumberId = session.whatsappPhoneNumberId || null;
  await sendText(from, t('humanHandoffConfirmed', lang), phoneNumberId);
  const order = await resolveRecentOrder(businessId, from, session);
  await notifyOwnerHandoff({
    businessId,
    order,
    customerPhone: from,
    customerName: session.customerName || contactName,
    lastMessage: text ?? '(handoff button)',
    session,
    phoneNumberId,
  });
  await patchSession(from, { consecutiveParseFailures: 0 }, session);
  return true;
}

function isHumanHandoffButton(id) {
  return id === HANDOFF_BUTTON_ID;
}

module.exports = {
  POST_ORDER_CONTEXT_MS,
  HANDOFF_BUTTON_ID,
  detectCancelOrderRequest,
  looksLikePostOrderModify,
  canCustomerCancel,
  isPostOrderContextExpired,
  isHumanHandoffButton,
  tryReplyOrderStatus,
  tryHandlePostOrderMessage,
  handlePostOrderCancelButton,
  recordParseFailure,
  resetParseFailures,
  handleHumanHandoffButton,
  POST_ORDER_CLEAR_PATCH,
};
