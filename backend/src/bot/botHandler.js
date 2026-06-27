const { getSession, setSession } = require('./sessionStore');
const { getBusinessInfo } = require('./menuService');
const { sendText, sendLocationRequest, sendFlowMessage, deleteMessage } = require('../lib/whatsapp');
const { detectLanguage, scoreLanguage, getOverride } = require('./languageDetector');
const { t } = require('./templates');
const { isOrderingOpen, getTodayOrderWindow } = require('../lib/schedule');
const { isAcceptingOrders } = require('../lib/presence');
const { getBusinessesInfo, sendRestaurantPicker, presentRestaurantPickerForLocation } = require('./botHelpers');
const { handleAwaitingLocation, handleSelectingRestaurant } = require('./states/restaurant');
const { handleAwaitingConfirmNote, handleAwaitingOrderType, handleAwaitingDeliveryAddressChoice, handleAwaitingDeliveryAddress, handleAwaitingName, handleConfirming, handleAwaitingPaymentMethod } = require('./states/checkout');
const { handleSelecting, handleBrowsing } = require('./states/browsing');
const { startRestaurantBrowsing } = require('./reorder');
const { isGreetingOnly } = require('./intentParser');
const { handleIntentCustomize } = require('./intentCustomize');
const { handleDisambiguatingIntent } = require('./intentDisambiguate');
const { parseOrderDeepLink } = require('../lib/chatDeepLink');

const SWITCH_KEYWORDS = new Set(['switch', 'change', 'restaurants', 'back', 'home', 'wechseln', 'zurück', 'zuruck', 'değiştir', 'degistir', 'restoranlar', 'start']);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h safety net for abandoned browsing sessions
// Greeting while stuck in checkout → fresh menu/reorder, not "type YES or NO"
const GREETING_FRESH_START_STATES = new Set([
  'confirming',
  'awaiting_payment_method',
  'awaiting_name',
  'awaiting_order_type',
  'awaiting_delivery_address',
  'awaiting_delivery_address_choice',
  'awaiting_confirm_note',
  'selecting',
  'customizing_intent',
  'disambiguating_intent',
]);

const STATE_HANDLERS = {
  awaiting_location:                handleAwaitingLocation,
  selecting_restaurant:             handleSelectingRestaurant,
  selecting:                        handleSelecting,
  customizing_intent:               handleIntentCustomize,
  disambiguating_intent:            handleDisambiguatingIntent,
  awaiting_order_type:              handleAwaitingOrderType,
  awaiting_delivery_address_choice: handleAwaitingDeliveryAddressChoice,
  awaiting_delivery_address:        handleAwaitingDeliveryAddress,
  awaiting_name:                    handleAwaitingName,
  confirming:                       handleConfirming,
  awaiting_payment_method:          handleAwaitingPaymentMethod,
  awaiting_confirm_note:            handleAwaitingConfirmNote,
};

async function deleteStale(phone, session) {
  const ids = session.pendingDeleteIds ?? [];
  if (ids.length) await Promise.allSettled(ids.map(id => deleteMessage(id)));
}

async function enterRestaurantDirect(from, bid, lang) {
  const bidInfo = await getBusinessInfo(bid);
  if (!isOrderingOpen(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna')) {
    const window = getTodayOrderWindow(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna');
    await sendText(from, t('restaurantClosed', lang, bidInfo.name, window?.firstOrderTime ?? null, window?.lastOrderTime ?? null));
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] });
    return;
  }
  if (!isAcceptingOrders(bidInfo)) {
    await sendText(from, t('ordersClosedByOwner', lang, bidInfo.name));
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] });
    return;
  }
  const freshSession = { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] };
  await startRestaurantBrowsing({
    from, session: freshSession, lang, businessId: bid, type: 'text', text: '', norm: '', businessName: bidInfo.name,
  });
}

// routing: { businessIds: string[], defaultBusinessId: string|null }
// message shape:
//   { type: 'text', text }
//   { type: 'list_reply', id, title }       — list menu or restaurant picker
//   { type: 'button_reply', id, title }
//   { type: 'cart_submitted', items: [{ productId, qty, price, currency }] } — catalog flow
//   { type: 'flow_completion', data: { item_id, protein, quantity, sauces_text, special_requests, total, unit_price } }
async function handleMessage(routing, { from, contactName, type, text, id, items, data, latitude, longitude }) {
  if (!routing.businessIds.length) {
    console.warn(`[bot] no restaurants routed for this WhatsApp number — ignoring message from ${from}`);
    return;
  }

  let session = await getSession(from);
  if (routing.phoneNumberId) {
    session = { ...session, whatsappPhoneNumberId: routing.phoneNumberId };
  }
  const norm = (text ?? '').trim().toLowerCase();
  const isMulti = routing.businessIds.length > 1;

  await deleteStale(from, session);

  // QR deep link — any session; skip menu search on the ORDER token text.
  if (type === 'text') {
    const deepBid = parseOrderDeepLink(text, routing.businessIds);
    if (deepBid) {
      const lang = session.language || detectLanguage(text) || 'de';
      await enterRestaurantDirect(from, deepBid, lang);
      return;
    }
  }

  // Language override (text only)
  if (type === 'text') {
    const overrideLang = getOverride(norm);
    if (overrideLang) {
      await setSession(from, { ...session, language: overrideLang, pendingDeleteIds: [] });
      await sendText(from, t('langChanged', overrideLang));
      return;
    }
  }

  // DEV only: send flow on keyword "flow" — disabled in production
  if (process.env.NODE_ENV !== 'production' && type === 'text' && norm === 'flow') {
    const bid = session.businessId || routing.defaultBusinessId || routing.businessIds[0];
    await sendFlowMessage(from, {
      flowId: process.env.WHATSAPP_FLOW_ID || '1465498598663384',
      flowToken: `${from}|${bid}`,
      flowCta: 'Open Menu',
      screen: 'CATEGORY_SELECT',
      body: 'Tap to browse the menu',
      data: {},
    });
    return;
  }

  // Re-detect language mid-conversation on clear signal (≥2 keyword hits), to prevent
  // flipping on a single borrowed word (e.g. "ok" or "ja" in a Turkish message).
  if (type === 'text' && session.language) {
    const { lang: reDetected, score } = scoreLanguage(text ?? '');
    if (score >= 2 && reDetected !== session.language) {
      session = { ...session, language: reDetected };
      await setSession(from, session);
    }
  }

  // TTL safety net: abandoned browsing session (no order placed, idle 8h+)
  const lastActive = session.updatedAt?.toDate?.() ?? null;
  const isIdleBrowsing = session.state === 'browsing'
    && (session.basket ?? []).length === 0
    && !!session.businessId;
  const sessionExpiredForPicker = isMulti && isIdleBrowsing && lastActive
    && (Date.now() - lastActive.getTime() > SESSION_TTL_MS);

  // First message OR multi-restaurant with no restaurant selected yet OR TTL expired
  // (skip if already in selecting_restaurant — let the state machine handle the reply)
  if (!session.language || (isMulti && !session.businessId && session.state !== 'selecting_restaurant' && session.state !== 'awaiting_location') || sessionExpiredForPicker) {
    const lang = session.language || (type === 'text' ? detectLanguage(text) : null);

    if (type === 'text') {
      const deepBid = parseOrderDeepLink(text, routing.businessIds);
      if (deepBid) {
        await enterRestaurantDirect(from, deepBid, lang || 'de');
        return;
      }
    }

    if (isMulti) {
      const langForMulti = lang || 'en';
      // Set state before the API call so a failed sendLocationRequest can't leave the bot looping;
      // if the call succeeds, update pendingDeleteIds so the message is cleaned up next turn.
      await setSession(from, { state: 'awaiting_location', language: langForMulti, basket: [], businessId: null, pendingDeleteIds: [] });
      try {
        const locId = await sendLocationRequest(from, t('locationRequestBody', langForMulti));
        if (locId) await setSession(from, { state: 'awaiting_location', language: langForMulti, basket: [], businessId: null, pendingDeleteIds: [locId] });
      } catch { /* ignore — awaiting_location handler will show the picker on next message */ }
      return;
    }
    const bid = routing.defaultBusinessId || routing.businessIds[0];
    const bidInfo = await getBusinessInfo(bid);
    const langResolved = lang || bidInfo.botLanguage || 'de';
    if (!isOrderingOpen(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna')) {
      const _w0 = getTodayOrderWindow(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', langResolved, bidInfo.name, _w0?.firstOrderTime ?? null, _w0?.lastOrderTime ?? null));
      await setSession(from, { state: 'browsing', language: langResolved, basket: [], businessId: bid, pendingDeleteIds: [] });
      return;
    }
    if (!isAcceptingOrders(bidInfo)) {
      await sendText(from, t('ordersClosedByOwner', langResolved, bidInfo.name));
      await setSession(from, { state: 'browsing', language: langResolved, basket: [], businessId: bid, pendingDeleteIds: [] });
      return;
    }
    const freshSession = { state: 'browsing', language: langResolved, basket: [], businessId: bid, pendingDeleteIds: [] };
    await startRestaurantBrowsing({
      from, session: freshSession, lang: langResolved, businessId: bid, type, text, norm, businessName: bidInfo.name,
    });
    return;
  }

  const lang = session.language;
  // Validate session.businessId is still in the current routing — prevents stale sessions
  // from locking a customer to a restaurant that's been removed or replaced.
  const sessionBidValid = session.businessId && routing.businessIds.includes(session.businessId);
  const businessId = sessionBidValid
    ? session.businessId
    : (routing.defaultBusinessId || routing.businessIds[0]);
  const basket = session.basket ?? [];

  // Abandoned checkout + greeting → restart ordering (Layer 0 / catalog), not yesNoOnly
  if (type === 'text' && isGreetingOnly(norm) && GREETING_FRESH_START_STATES.has(session.state)) {
    const bidInfo = await getBusinessInfo(businessId);
    if (!isOrderingOpen(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna')) {
      const _w = getTodayOrderWindow(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', lang, bidInfo.name, _w?.firstOrderTime ?? null, _w?.lastOrderTime ?? null));
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [] });
      return;
    }
    if (!isAcceptingOrders(bidInfo)) {
      await sendText(from, t('ordersClosedByOwner', lang, bidInfo.name));
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [] });
      return;
    }
    await startRestaurantBrowsing({
      from,
      session: {
        state: 'browsing',
        language: lang,
        basket: [],
        businessId,
        lat: session.lat ?? null,
        lng: session.lng ?? null,
        pendingDeleteIds: [],
      },
      lang,
      businessId,
      type,
      text,
      norm,
      businessName: bidInfo.name,
    });
    return;
  }

  // Switch restaurant command — available from any state (multi only)
  if (isMulti && type === 'text' && SWITCH_KEYWORDS.has(norm)) {
    await sendText(from, t('switchConfirmed', lang));
    if (session.lat != null && session.lng != null) {
      const { pendingDeleteIds } = await presentRestaurantPickerForLocation(
        from, routing.businessIds, session.lat, session.lng, lang,
      );
      await setSession(from, {
        state: 'selecting_restaurant',
        language: lang,
        basket: [],
        businessId: null,
        lat: session.lat,
        lng: session.lng,
        pendingDeleteIds,
        restaurantPickerUnfiltered: false,
      });
    } else {
      const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
      await setSession(from, { state: 'awaiting_location', language: lang, basket: [], businessId: null, pendingDeleteIds: locId ? [locId] : [] });
    }
    return;
  }

  const ctx = { from, contactName, session, lang, businessId, basket, isMulti, routing, type, text, norm, id, items, data, latitude, longitude };
  await (STATE_HANDLERS[session.state] ?? handleBrowsing)(ctx);
}

module.exports = { handleMessage };
