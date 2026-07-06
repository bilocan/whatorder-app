const { patchSession } = require('./sessionStore');
const { sendText, sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { getBusinessInfo, getMenuContext } = require('./menuService');
const { looksLikeOrderText } = require('./intentParser');
const { parseBasketOps } = require('./basketOps');
const { formatBasketItemsText } = require('./botHelpers');
const { isConversationalBasket } = require('./featureFlags');
const { detectOrderStatusQuestion } = require('./orderStatusDetect');
const {
  getOrder,
  amendOrderAddItems,
  cancelOrder,
  getLastOrderForCustomer,
} = require('./orderService');

const AMEND_WINDOW_MS = 15 * 60 * 1000;
// How long after placing an order typed order text is still treated as a modify
// attempt (→ call-restaurant when the amend window is closed). Beyond this,
// order text is a new order and the stale amend context must not swallow it.
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

function isAmendWindowOpen(order, placedAtMs) {
  if (!order || order.status !== 'pending') return false;
  if (!placedAtMs) return false;
  return Date.now() - placedAtMs < AMEND_WINDOW_MS;
}

function isPostOrderContextExpired(placedAtMs) {
  if (!placedAtMs) return true;
  return Date.now() - placedAtMs > POST_ORDER_CONTEXT_MS;
}

function isCashOrder(order) {
  return order.paymentMethod !== 'stripe';
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
    const basketSummary = (session.basket ?? []).length
      ? formatBasketItemsText(session.basket, { numbered: false, mergeIdentical: true })
      : '(empty)';
    const ownerMsg = [
      '🔔 Customer needs help',
      '',
      `Customer: ${customerName || 'WhatsApp Customer'} (${customerPhone})`,
      `State: ${session.state ?? 'browsing'}`,
      `Basket: ${basketSummary}`,
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

async function tryHandlePostOrderMessage({
  from, session, lang, businessId, text, norm, contactName,
}) {
  if (!session.pendingAmendOrderId) return false;
  if (!looksLikePostOrderModify(text, norm)) return false;

  const placedAtMs = session.pendingAmendPlacedAt ?? null;
  const isCancelRequest = detectCancelOrderRequest(text, norm);
  if (!isCancelRequest && isPostOrderContextExpired(placedAtMs)) {
    await clearPostOrderSession(from, session);
    return false;
  }

  const phoneNumberId = session.whatsappPhoneNumberId || null;
  const order = await getOrder(businessId, session.pendingAmendOrderId);
  if (!order) {
    await clearPostOrderSession(from, session);
    return false;
  }

  const windowOpen = isAmendWindowOpen(order, placedAtMs);
  const info = await getBusinessInfo(businessId);
  const convoOn = isConversationalBasket(info);

  if (isCancelRequest) {
    if (windowOpen && isCashOrder(order) && convoOn) {
      await cancelOrder(businessId, order.id);
      await clearPostOrderSession(from, session, { consecutiveParseFailures: 0 });
      return true;
    }
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  if (!isCashOrder(order) || !convoOn) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  if (!windowOpen) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  const { menu, menuMatch, menuTokenIndex } = await getMenuContext(businessId);
  const parsed = await parseBasketOps(text, {
    basket: order.items ?? [],
    businessId,
    phone: from,
    menu,
    menuMatch,
    menuTokenIndex,
  });

  if (parsed.outcome !== 'ops' || !parsed.ops?.length) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  const addOps = parsed.ops.filter(op => op.type === 'add');
  if (!addOps.length || addOps.length !== parsed.ops.length) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  const { applied } = await amendOrderAddItems(businessId, order.id, addOps.map(op => op.item));
  if (!applied?.length) {
    await sendCallRestaurantReply({ from, lang, businessId, phoneNumberId });
    return true;
  }

  const updated = await getOrder(businessId, order.id);
  const itemLines = formatBasketItemsText(updated.items, { numbered: false, mergeIdentical: true });
  await sendText(
    from,
    t('postOrderAmended', lang, orderShortId(order.id), itemLines, updated.total.toFixed(2)),
    phoneNumberId,
  );
  return true;
}

async function recordParseFailure({ from, session, lang, businessId, text, contactName }) {
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
  AMEND_WINDOW_MS,
  POST_ORDER_CONTEXT_MS,
  HANDOFF_BUTTON_ID,
  detectCancelOrderRequest,
  looksLikePostOrderModify,
  isAmendWindowOpen,
  isPostOrderContextExpired,
  isHumanHandoffButton,
  tryReplyOrderStatus,
  tryHandlePostOrderMessage,
  recordParseFailure,
  resetParseFailures,
  handleHumanHandoffButton,
  POST_ORDER_CLEAR_PATCH,
};
