const { getSession, setSession } = require('./sessionStore');
const { getBusinessInfo } = require('./menuService');
const { sendText, sendLocationRequest, sendFlowMessage, deleteMessage } = require('../lib/whatsapp');
const {
  PLATFORM_IDENTITY,
  runWithMessageIdentity,
  setMessageIdentity,
  applyBusinessInfoIdentity,
} = require('../lib/messageIdentity');
const { detectLanguage, scoreLanguage, getOverride } = require('./languageDetector');
const { t } = require('./templates');
const { isOrderingOpen, getTodayOrderWindow } = require('../lib/schedule');
const { isAcceptingOrders } = require('../lib/presence');
const { getBusinessesInfo, sendRestaurantPicker, presentRestaurantPickerForLocation } = require('./botHelpers');
const { handleAwaitingLocation, handleSelectingRestaurant } = require('./states/restaurant');
const { handleAwaitingConfirmNote, handleAwaitingOrderType, handleAwaitingDeliveryAddressChoice, handleAwaitingDeliveryAddress, handleAwaitingDeliveryAddressConfirm, handleAwaitingDeliveryAddressUnit, handleAwaitingName, handleConfirming } = require('./states/checkout');
const { handleSelecting, handleBrowsing } = require('./states/browsing');
const { startRestaurantBrowsing } = require('./reorder');
const { isGreetingOnly, isFreshStartCommand } = require('./intentParser');
const { handleIntentCustomize } = require('./intentCustomize');
const { handleDisambiguatingIntent } = require('./intentDisambiguate');
const { parseOrderDeepLink } = require('../lib/chatDeepLink');
const { redactPhone } = require('../lib/logRedact');
const {
  tryReplyOrderStatus,
  tryHandlePostOrderMessage,
  isHumanHandoffButton,
  handleHumanHandoffButton,
  handlePostOrderCancelButton,
} = require('./postOrder');

// Restaurant switch only — "start"/"starten" are fresh-start at the current venue (see isFreshStartCommand).
const SWITCH_KEYWORDS = new Set(['switch', 'change', 'restaurants', 'back', 'home', 'wechseln', 'zurück', 'zuruck', 'değiştir', 'degistir', 'restoranlar']);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h safety net for abandoned browsing sessions (empty basket only)
// Greeting while stuck in checkout → fresh menu/reorder, not "type YES or NO" (empty basket only)
const GREETING_FRESH_START_STATES = new Set([
  'confirming',
  'awaiting_name',
  'awaiting_order_type',
  'awaiting_delivery_address',
  'awaiting_delivery_address_choice',
  'awaiting_delivery_address_confirm',
  'awaiting_delivery_address_unit',
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
  awaiting_delivery_address_confirm: handleAwaitingDeliveryAddressConfirm,
  awaiting_delivery_address_unit:   handleAwaitingDeliveryAddressUnit,
  awaiting_name:                    handleAwaitingName,
  confirming:                       handleConfirming,
  awaiting_confirm_note:            handleAwaitingConfirmNote,
};

async function deleteStale(phone, session) {
  const ids = session.pendingDeleteIds ?? [];
  if (ids.length) await Promise.allSettled(ids.map(id => deleteMessage(id)));
}

async function enterRestaurantDirect(from, bid, lang) {
  const bidInfo = await getBusinessInfo(bid);
  applyBusinessInfoIdentity(bidInfo);
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

async function handleMessageInner(routing, { from, contactName, type, text, id, items, data, latitude, longitude }) {
  if (!routing.businessIds.length) {
    console.warn(`[bot] no restaurants routed for this WhatsApp number — ignoring message from ${redactPhone(from)}`);
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
      if (session.businessId && routing.businessIds.includes(session.businessId)) {
        applyBusinessInfoIdentity(await getBusinessInfo(session.businessId));
      }
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

  // Post-order action buttons must work even in multi-restaurant mode where session.businessId
  // is null after order placement. Intercept before the restaurant-picker early return.
  if (type === 'button_reply' && (id === 'btn_post_cancel' || id === 'btn_post_reorder' || id === 'btn_post_restaurant')) {
    const postLang = session.language || 'de';
    const postBid = session.pendingAmendBusinessId || session.businessId || routing.defaultBusinessId || routing.businessIds[0];
    if (id === 'btn_post_cancel') {
      await handlePostOrderCancelButton({ from, session, lang: postLang, businessId: postBid });
      return;
    }
    if (id === 'btn_post_restaurant' && isMulti) {
      const phoneNumberId = session.whatsappPhoneNumberId || null;
      await setSession(from, { state: 'awaiting_location', language: postLang, basket: [], businessId: null, pendingDeleteIds: [] });
      try {
        await sendText(from, t('multiWelcomeBody', postLang), phoneNumberId);
        const locId = await sendLocationRequest(from, t('locationRequestBody', postLang));
        if (locId) await setSession(from, { state: 'awaiting_location', language: postLang, basket: [], businessId: null, pendingDeleteIds: [locId] });
      } catch { /* ignore — awaiting_location handler will show picker on next message */ }
      return;
    }
    const postInfo = await getBusinessInfo(postBid);
    applyBusinessInfoIdentity(postInfo);
    await startRestaurantBrowsing({ from, session: { ...session, basket: [] }, lang: postLang, businessId: postBid, type, text, norm, businessName: postInfo.name });
    return;
  }

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
        await sendText(from, t('multiWelcomeBody', langForMulti));
        const locId = await sendLocationRequest(from, t('locationRequestBody', langForMulti));
        if (locId) await setSession(from, { state: 'awaiting_location', language: langForMulti, basket: [], businessId: null, pendingDeleteIds: [locId] });
      } catch { /* ignore — awaiting_location handler will show the picker on next message */ }
      return;
    }
    const bid = routing.defaultBusinessId || routing.businessIds[0];
    const bidInfo = await getBusinessInfo(bid);
    applyBusinessInfoIdentity(bidInfo);
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

  // Abandoned checkout (empty basket) + greeting, or explicit fresh-start → catalog/reorder.
  // Greeting with non-empty basket: keep in-progress order — fall through to checkout handler.
  const checkoutFreshStart = type === 'text' && GREETING_FRESH_START_STATES.has(session.state)
    && (isFreshStartCommand(norm) || (isGreetingOnly(norm) && basket.length === 0));
  if (checkoutFreshStart) {
    const bidInfo = await getBusinessInfo(businessId);
    applyBusinessInfoIdentity(bidInfo);
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

  // Switch restaurant command — available from any state (multi only).
  // Always re-request location so a stale/wrong pin (e.g. Linz while testing Wien) is not reused.
  // Platform identity: switch leaves the restaurant context.
  if (isMulti && type === 'text' && SWITCH_KEYWORDS.has(norm)) {
    setMessageIdentity(PLATFORM_IDENTITY);
    await sendText(from, t('switchConfirmed', lang));
    await sendText(from, t('multiWelcomeBody', lang));
    const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
    await setSession(from, {
      state: 'awaiting_location',
      language: lang,
      basket: [],
      businessId: null,
      lat: null,
      lng: null,
      pendingDeleteIds: locId ? [locId] : [],
      restaurantPickerUnfiltered: false,
    });
    return;
  }

  // Multi without a selected restaurant stays on WhatOrder; otherwise label as Name, PLZ Ort.
  if (sessionBidValid) {
    applyBusinessInfoIdentity(await getBusinessInfo(session.businessId));
  } else if (!isMulti) {
    applyBusinessInfoIdentity(await getBusinessInfo(businessId));
  } else {
    setMessageIdentity(PLATFORM_IDENTITY);
  }

  const ctx = { from, contactName, session, lang, businessId, basket, isMulti, routing, type, text, norm, id, items, data, latitude, longitude };

  if (type === 'button_reply' && isHumanHandoffButton(id)) {
    await handleHumanHandoffButton({ from, session, lang, businessId, contactName, text });
    return;
  }

  if (type === 'text' && text?.trim()) {
    if (await tryReplyOrderStatus({ from, session, lang, businessId, text })) return;
    if (await tryHandlePostOrderMessage({ from, session, lang, businessId, text, norm, contactName })) return;
  }

  await (STATE_HANDLERS[session.state] ?? handleBrowsing)(ctx);
}

// routing: { businessIds: string[], defaultBusinessId: string|null }
// message shape:
//   { type: 'text', text }
//   { type: 'list_reply', id, title }       — list menu or restaurant picker
//   { type: 'button_reply', id, title }
//   { type: 'cart_submitted', items: [{ productId, qty, price, currency }] } — catalog flow
//   { type: 'flow_completion', data: { item_id, protein, quantity, sauces_text, special_requests, total, unit_price } }
async function handleMessage(routing, message) {
  return runWithMessageIdentity(PLATFORM_IDENTITY, () => handleMessageInner(routing, message));
}

module.exports = { handleMessage };
