const { getSession, setSession, patchSession } = require('./sessionStore');
const { getBusinessInfo } = require('./menuService');
const { sendText, sendLocationRequest, sendFlowMessage, sendButtonMessage, deleteMessage } = require('../lib/whatsapp');
const {
  PLATFORM_IDENTITY,
  runWithMessageIdentity,
  setMessageIdentity,
  applyBusinessInfoIdentity,
} = require('../lib/messageIdentity');
const { detectLanguage, scoreLanguage, getOverride } = require('./languageDetector');
const {
  getPreferredLanguage,
  setPreferredLanguage,
  langFromButtonId,
  languagePickButtons,
} = require('./customerLanguage');
const { t } = require('./templates');
const { isOrderingOpen, getTodayOrderWindow } = require('../lib/schedule');
const { isAcceptingOrders } = require('../lib/presence');
const { handleAwaitingLocation, handleSelectingRestaurant, refuseClosedRestaurant } = require('./states/restaurant');
const { handleAwaitingConfirmNote, handleAwaitingOrderType, handleAwaitingDeliveryAddressChoice, handleAwaitingDeliveryAddress, handleAwaitingDeliveryAddressConfirm, handleAwaitingDeliveryAddressUnit, handleAwaitingName, handleConfirming, handlePaymentBack, isPaymentBackButtonId } = require('./states/checkout');
const { handleSelecting, handleBrowsing } = require('./states/browsing');
const { startRestaurantBrowsing } = require('./reorder');
const { beginRestaurantSwitch } = require('./restaurantSwitch');
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
  detectCancelOrderRequest,
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

/** Cart / Flow completions must not be blocked by the language gate (stale open Flows). */
const LANGUAGE_GATE_PASSTHROUGH = new Set(['cart_submitted', 'flow_completion']);

async function offerLanguagePick(from, session = {}, { pendingDeepBid = null, phoneNumberId = null } = {}) {
  const alreadyPicking = session.state === 'awaiting_language';
  const phoneId = phoneNumberId || session.whatsappPhoneNumberId || null;
  const deepBid = pendingDeepBid != null ? pendingDeepBid : (session.pendingDeepBid || null);

  if (alreadyPicking) {
    // Re-prompt: keep basket / businessId (menu Flow may have written them concurrently).
    await patchSession(from, {
      state: 'awaiting_language',
      language: null,
      pendingDeepBid: deepBid,
      ...(phoneId ? { whatsappPhoneNumberId: phoneId } : {}),
    });
  } else {
    await setSession(from, {
      state: 'awaiting_language',
      language: null,
      basket: [],
      businessId: null,
      pendingDeleteIds: [],
      pendingDeepBid: deepBid,
      ...(phoneId ? { whatsappPhoneNumberId: phoneId } : {}),
    });
  }
  const msgId = await sendButtonMessage(from, {
    body: t('languagePickBody', 'en'),
    buttons: languagePickButtons(t),
  });
  if (msgId) await patchSession(from, { pendingDeleteIds: [msgId] });
}

async function enterRestaurantDirect(from, bid, lang, session, routing) {
  const bidInfo = await getBusinessInfo(bid);
  applyBusinessInfoIdentity(bidInfo);
  if (!isOrderingOpen(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna')) {
    const continued = await refuseClosedRestaurant({
      from, session, lang, routing, selectedBid: bid, selectedInfo: bidInfo, gate: 'hours',
    });
    if (!continued) {
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] });
    }
    return;
  }
  if (!isAcceptingOrders(bidInfo)) {
    const continued = await refuseClosedRestaurant({
      from, session, lang, routing, selectedBid: bid, selectedInfo: bidInfo, gate: 'orders',
    });
    if (!continued) {
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] });
    }
    return;
  }
  const freshSession = { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] };
  await startRestaurantBrowsing({
    from, session: freshSession, lang, businessId: bid, type: 'text', text: '', norm: '', businessName: bidInfo.name,
    isMulti: routing.businessIds.length > 1,
  });
}

async function continueAfterLanguagePick(from, lang, session, routing) {
  const deepBid = session.pendingDeepBid;
  const isMulti = routing.businessIds.length > 1;

  if (deepBid && routing.businessIds.includes(deepBid)) {
    await setSession(from, {
      state: 'browsing',
      language: lang,
      basket: [],
      businessId: deepBid,
      pendingDeleteIds: [],
      pendingDeepBid: null,
    });
    await enterRestaurantDirect(from, deepBid, lang, session, routing);
    return;
  }

  if (isMulti) {
    await setSession(from, {
      state: 'awaiting_location',
      language: lang,
      basket: [],
      businessId: null,
      pendingDeleteIds: [],
      pendingDeepBid: null,
    });
    try {
      const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
      if (locId) await patchSession(from, { pendingDeleteIds: [locId] });
    } catch { /* awaiting_location handler will show picker on next message */ }
    return;
  }

  const bid = routing.defaultBusinessId || routing.businessIds[0];
  const bidInfo = await getBusinessInfo(bid);
  applyBusinessInfoIdentity(bidInfo);
  if (!isOrderingOpen(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna')) {
    const _w0 = getTodayOrderWindow(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna');
    await sendText(from, t('restaurantClosed', lang, bidInfo.name, _w0?.firstOrderTime ?? null, _w0?.lastOrderTime ?? null));
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [], pendingDeepBid: null });
    return;
  }
  if (!isAcceptingOrders(bidInfo)) {
    await sendText(from, t('ordersClosedByOwner', lang, bidInfo.name));
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [], pendingDeepBid: null });
    return;
  }
  const freshSession = {
    state: 'browsing',
    language: lang,
    basket: [],
    businessId: bid,
    pendingDeleteIds: [],
    pendingDeepBid: null,
  };
  await setSession(from, freshSession);
  await startRestaurantBrowsing({
    from, session: freshSession, lang, businessId: bid, type: 'text', text: '', norm: '', businessName: bidInfo.name,
    isMulti: false,
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
  const preferredLanguage = await getPreferredLanguage(from);
  if (preferredLanguage && session.language !== preferredLanguage) {
    session = { ...session, language: preferredLanguage };
  }
  const norm = (text ?? '').trim().toLowerCase();
  const isMulti = routing.businessIds.length > 1;

  await deleteStale(from, session);

  // Explicit language buttons (first pick or later re-tap).
  if (type === 'button_reply') {
    const picked = langFromButtonId(id);
    if (picked) {
      await setPreferredLanguage(from, picked);
      const wasPicking = session.state === 'awaiting_language' || !session.language;
      if (wasPicking) {
        await continueAfterLanguagePick(from, picked, session, routing);
      } else {
        if (session.businessId && routing.businessIds.includes(session.businessId)) {
          applyBusinessInfoIdentity(await getBusinessInfo(session.businessId));
        }
        await setSession(from, { ...session, language: picked, pendingDeleteIds: [] });
        await sendText(from, t('langChanged', picked));
      }
      return;
    }
  }

  // Language override keywords (also persist preferred language).
  if (type === 'text') {
    const overrideLang = getOverride(norm);
    if (overrideLang) {
      await setPreferredLanguage(from, overrideLang);
      const wasPicking = session.state === 'awaiting_language' || (!preferredLanguage && !session.language);
      if (wasPicking) {
        await continueAfterLanguagePick(from, overrideLang, session, routing);
        return;
      }
      if (session.businessId && routing.businessIds.includes(session.businessId)) {
        applyBusinessInfoIdentity(await getBusinessInfo(session.businessId));
      }
      await setSession(from, { ...session, language: overrideLang, pendingDeleteIds: [] });
      await sendText(from, t('langChanged', overrideLang));
      return;
    }
  }

  // Durable pref exists but session stuck in awaiting_language (crash / set_language / race).
  // Resume restaurant flow; never re-show the picker.
  if (preferredLanguage && session.state === 'awaiting_language') {
    session = { ...session, language: preferredLanguage };
    if (!LANGUAGE_GATE_PASSTHROUGH.has(type)) {
      if (type === 'text') {
        const deepBid = parseOrderDeepLink(text, routing.businessIds);
        if (deepBid) session = { ...session, pendingDeepBid: deepBid };
      }
      await continueAfterLanguagePick(from, preferredLanguage, session, routing);
      return;
    }
    await patchSession(from, { language: preferredLanguage, state: 'browsing' });
    session = { ...session, language: preferredLanguage, state: 'browsing' };
  }

  // First-time language gate (no durable pref and no in-session language yet).
  // cart_submitted / flow_completion pass through so an open Flow is not dropped.
  const needsLanguage = !preferredLanguage && !session.language;
  if (needsLanguage && !LANGUAGE_GATE_PASSTHROUGH.has(type)) {
    if (type === 'text') {
      const deepBid = parseOrderDeepLink(text, routing.businessIds);
      if (deepBid) {
        await offerLanguagePick(from, session, {
          pendingDeepBid: deepBid,
          phoneNumberId: routing.phoneNumberId || session.whatsappPhoneNumberId,
        });
        return;
      }
    }
    await offerLanguagePick(from, session, {
      pendingDeepBid: session.pendingDeepBid || null,
      phoneNumberId: routing.phoneNumberId || session.whatsappPhoneNumberId,
    });
    return;
  }

  // QR deep link — any session; skip menu search on the ORDER token text.
  if (type === 'text') {
    const deepBid = parseOrderDeepLink(text, routing.businessIds);
    if (deepBid) {
      const lang = session.language || preferredLanguage || 'de';
      await enterRestaurantDirect(from, deepBid, lang, session, routing);
      return;
    }
  }

  // Soft re-detect only when the customer has not chosen a durable preferred language.
  if (type === 'text' && session.language && !preferredLanguage) {
    const { lang: reDetected, score } = scoreLanguage(text ?? '');
    if (score >= 2 && reDetected !== session.language) {
      session = { ...session, language: reDetected };
      await setSession(from, session);
    }
  }

  // Test/local only: keyword "flow" opens the menu Flow.
  // Gate on DEPLOY_ENV — Cloud Run images set NODE_ENV=production even for Test.
  const deployEnv = process.env.DEPLOY_ENV;
  const flowKeywordEnv = deployEnv === 'test'
    || (!deployEnv && process.env.NODE_ENV !== 'production');
  if (flowKeywordEnv && type === 'text' && norm === 'flow') {
    // Same Rule 1 validation as the main path — never trust a stale session.businessId.
    const sessionBidValid = session.businessId && routing.businessIds.includes(session.businessId);
    const bid = sessionBidValid
      ? session.businessId
      : (routing.defaultBusinessId || routing.businessIds[0]);
    await sendFlowMessage(from, {
      flowId: process.env.WHATSAPP_MENU_FLOW_ID || process.env.WHATSAPP_FLOW_ID || '1465498598663384',
      flowToken: `${from}|${bid}`,
      flowCta: 'Open Menu',
      body: 'Tap to browse the menu',
      flowAction: 'data_exchange',
    });
    return;
  }

  // TTL safety net: abandoned browsing session (no order placed, idle 8h+)
  const lastActive = session.updatedAt?.toDate?.() ?? null;
  const isIdleBrowsing = session.state === 'browsing'
    && (session.basket ?? []).length === 0
    && !!session.businessId;
  const sessionExpiredForPicker = isMulti && isIdleBrowsing && lastActive
    && (Date.now() - lastActive.getTime() > SESSION_TTL_MS);

  // Ändern above an unpaid card pay link. Button id carries businessId|orderId so a
  // stale bubble withdraws that order. Legacy plain btn_payment_back uses pendingAmend*.
  if (type === 'button_reply' && isPaymentBackButtonId(id)) {
    const postLang = session.language || preferredLanguage || 'de';
    await handlePaymentBack({
      from,
      session,
      lang: postLang,
      buttonId: id,
      allowedBusinessIds: routing.businessIds,
    });
    return;
  }

  // Post-order action buttons must work even in multi-restaurant mode where session.businessId
  // is null after order placement. Intercept before the restaurant-picker early return.
  // Same for typed "Stornieren" / "iptal" (quote-reply or free text).
  const postBid = session.pendingAmendBusinessId || session.businessId || routing.defaultBusinessId || routing.businessIds[0];
  if (type === 'button_reply' && (id === 'btn_post_cancel' || id === 'btn_post_reorder' || id === 'btn_post_restaurant')) {
    const postLang = session.language || preferredLanguage || 'de';
    if (id === 'btn_post_cancel') {
      await handlePostOrderCancelButton({ from, session, lang: postLang, businessId: postBid, isMulti });
      return;
    }
    if (id === 'btn_post_restaurant' && isMulti) {
      // Post-order copy uses welcome location body (not switchLocationRequestBody).
      await setSession(from, { state: 'awaiting_location', language: postLang, basket: [], businessId: null, pendingDeleteIds: [] });
      try {
        const locId = await sendLocationRequest(from, t('locationRequestBody', postLang));
        if (locId) await setSession(from, { state: 'awaiting_location', language: postLang, basket: [], businessId: null, pendingDeleteIds: [locId] });
      } catch { /* ignore — awaiting_location handler will show picker on next message */ }
      return;
    }
    const postInfo = await getBusinessInfo(postBid);
    applyBusinessInfoIdentity(postInfo);
    await startRestaurantBrowsing({
      from, session: { ...session, basket: [] }, lang: postLang, businessId: postBid, type, text, norm,
      businessName: postInfo.name, isMulti,
    });
    return;
  }

  // Typed cancel after place must run before the multi restaurant-picker early return
  // (session.businessId is null). Gate on pendingAmend* so browsing "iptal" (e.g. clear
  // disambiguation) is not stolen by the post-order cancel path.
  if (
    type === 'text'
    && text?.trim()
    && detectCancelOrderRequest(text, norm)
    && (session.pendingAmendOrderId || session.pendingAmendBusinessId)
  ) {
    const postLang = session.language || preferredLanguage || detectLanguage(text) || 'de';
    await handlePostOrderCancelButton({ from, session, lang: postLang, businessId: postBid, isMulti });
    return;
  }

  // Multi-restaurant with no restaurant selected yet OR TTL expired
  // (skip if already in selecting_restaurant — let the state machine handle the reply)
  if ((isMulti && !session.businessId && session.state !== 'selecting_restaurant' && session.state !== 'awaiting_location') || sessionExpiredForPicker) {
    const lang = session.language || preferredLanguage || 'en';

    if (type === 'text') {
      const deepBid = parseOrderDeepLink(text, routing.businessIds);
      if (deepBid) {
        await enterRestaurantDirect(from, deepBid, lang, session, routing);
        return;
      }
    }

    // Set state before the API call so a failed sendLocationRequest can't leave the bot looping;
    // if the call succeeds, update pendingDeleteIds so the message is cleaned up next turn.
    await setSession(from, { state: 'awaiting_location', language: lang, basket: [], businessId: null, pendingDeleteIds: [] });
    try {
      // One interactive bubble only (welcome folded into location CTA copy).
      const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
      if (locId) await setSession(from, { state: 'awaiting_location', language: lang, basket: [], businessId: null, pendingDeleteIds: [locId] });
    } catch { /* ignore — awaiting_location handler will show the picker on next message */ }
    return;
  }

  const lang = session.language || preferredLanguage || 'de';
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
      isMulti,
    });
    return;
  }

  // Switch restaurant — keywords (test/fallback) or chat button (reorder / no-order welcome / post-order).
  // Always re-request location so a stale/wrong pin is not reused.
  if (isMulti && (
    (type === 'text' && SWITCH_KEYWORDS.has(norm))
    || (type === 'button_reply' && id === 'btn_switch_restaurant')
  )) {
    await beginRestaurantSwitch({ from, lang });
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
