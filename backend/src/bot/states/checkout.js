const { setSession, patchSession } = require('../sessionStore');
const { sendText, sendButtonMessage, sendListMessage, sendLocationRequest, sendCtaUrlMessage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { buildBasketText, sendCatalog, formatBasketItemsText, basketViewButtons, sendBasketView } = require('../botHelpers');
const { getBusinessInfo, getMenuContext } = require('../menuService');
const { createOrder } = require('../orderService');
const { customersRef, ordersRef } = require('../../lib/collections');
const { reverseGeocode } = require('../../lib/geocode');
const { isStripeConfigured } = require('../../lib/stripe');
const { createCheckoutSessionForOrder } = require('../../lib/paymentService');
const { isStrongOrderText, isGreetingOnly, isFreshStartCommand } = require('../intentParser');
const { isConversationalBasket } = require('../featureFlags');
const { tryBasketUndo } = require('../conversationalBasket');
const { isBasketUndoPhrase, detectBotCommandAsync, BOT_COMMAND } = require('../botCommands');
const {
  parseOrderTypeKeyword,
  isBareCheckoutDigit,
  tryCheckoutBasketOp,
} = require('../checkoutOps');
const { BASKET_CLEAR_PATCH } = require('../basketOps');
const {
  applyProfilePrefill,
  getMissingCheckoutSlots,
  isDeliveryOffered,
  isCheckoutOnlySegment,
  stripCheckoutSlotsFromOrderText,
  tryApplyCheckoutSlotsFromText,
  buildMenuFoodTokens,
} = require('../checkoutSlots');
const { sendOrderEntryPrompt } = require('../orderEntry');
const { basketSubtotal, orderTotals } = require('../orderTotals');
const { recordParseFailure, resetParseFailures } = require('../postOrder');

// M2: bare `1` no longer confirms — use list row btn_place_order only (digit disambiguation).
const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', 'ok', 'tamam', 'confirm', 'onayla', 'bestätigen', 'bestatigen']);
const CANCEL  = new Set(['no', 'hayır', 'hayir', 'nein', 'cancel', 'iptal']);

function isPaymentEnabled(info) {
  return info.paymentEnabled === true && isStripeConfigured();
}

function logPaymentSkipped(businessId, info) {
  if (info.paymentEnabled !== true) {
    console.warn(`[checkout] payment skipped for ${businessId}: paymentEnabled=${info.paymentEnabled ?? false}`);
  } else if (!isStripeConfigured()) {
    console.warn(`[checkout] payment skipped for ${businessId}: STRIPE_SECRET_KEY not set`);
  }
}

async function placeOrderAndNotify({ from, session, lang, businessId, basket, isMulti, contactName, paymentMethod }) {
  const info = await getBusinessInfo(businessId);
  const { subtotal, deliveryFee, total, isDelivery } = orderTotals(basket, session, info);
  const phoneNumberId = session.whatsappPhoneNumberId || null;
  const orderId = await createOrder(businessId, {
    customerPhone: from,
    customerName: session.customerName || contactName || null,
    items: basket,
    total: subtotal,
    language: lang,
    pickupTime: isDelivery ? null : (session.pickupTime || null),
    notes: session.specialRequests || null,
    orderType: session.orderType || 'pickup',
    deliveryAddress: session.deliveryAddress || null,
    deliveryFee,
    paymentMethod,
    paymentStatus: paymentMethod === 'stripe' ? 'pending' : 'cash',
    whatsappPhoneNumberId: session.whatsappPhoneNumberId || null,
  });
  const shortId = orderId.slice(-6).toUpperCase();
  const itemLines = formatBasketItemsText(basket, { numbered: false, mergeIdentical: true });

  await setSession(from, {
    state: 'browsing',
    language: lang,
    basket: [],
    businessId: isMulti ? null : businessId,
    pendingDeleteIds: [],
    pendingAmendOrderId: orderId,
    pendingAmendBusinessId: businessId,
    pendingAmendPlacedAt: Date.now(),
    consecutiveParseFailures: 0,
  });

  if (paymentMethod === 'stripe') {
    try {
      const { url, sessionId } = await createCheckoutSessionForOrder(businessId, orderId, {
        totalEuros: total,
        restaurantName: info.name,
        shortId,
        lang,
      });
      await ordersRef(businessId).doc(orderId).update({ paymentStripeSessionId: sessionId });
      await sendCtaUrlMessage(from, {
        body: t('paymentLink', lang, shortId, itemLines, total.toFixed(2), info.name, info.alertPhone || null, info.address || null, isDelivery ? (session.deliveryAddress || null) : null),
        buttonLabel: t('payNowBtn', lang),
        url,
      }, phoneNumberId);
    } catch (err) {
      console.error('[payment] checkout session failed:', err.message);
      await sendText(from, t('paymentLinkFailed', lang, shortId), phoneNumberId);
    }
    return;
  }

  await sendText(from, t('orderReceipt', lang, shortId, info.name, itemLines, total.toFixed(2), session.pickupTime, session.customerName, session.deliveryAddress ?? null, paymentMethod, info.alertPhone || null, info.address || null), phoneNumberId);
  await sendButtonMessage(from, {
    body: t('postOrderOptions', lang),
    buttons: [
      { id: 'btn_post_cancel',     title: t('postCancelBtn', lang) },
      { id: 'btn_post_reorder',    title: t('postReorderBtn', lang) },
      { id: 'btn_post_restaurant', title: t('postRestaurantBtn', lang) },
    ],
  }, phoneNumberId);
}

async function getKnownName(phone, businessId) {
  try {
    const snap = await customersRef(businessId).doc(phone).get();
    const name = snap.data()?.name;
    return (name && name !== 'WhatsApp Customer') ? name : null;
  } catch {
    return null;
  }
}

async function getCustomerProfile(phone, businessId) {
  try {
    const snap = await customersRef(businessId).doc(phone).get();
    const data = snap.data();
    if (!data) return null;
    return {
      name: data.name ?? null,
      lastDeliveryAddress: data.lastDeliveryAddress ?? null,
    };
  } catch {
    return null;
  }
}

async function resolveCustomerName(session, phone, businessId) {
  const fromSession = session.customerName;
  if (fromSession && fromSession !== 'WhatsApp Customer') return fromSession;
  return getKnownName(phone, businessId);
}

async function finishToConfirming(from, session, lang, businessId, basket) {
  const info = await getBusinessInfo(businessId);
  const cleared = { ...session, confirmingOrderTypeEdit: false };
  if (isConversationalBasket(info)) {
    await advanceCheckoutFromSlots({ from, session: cleared, lang, businessId, basket, info });
    return;
  }
  const name = await resolveCustomerName(session, from, businessId);
  if (name) {
    await transitionToConfirming(from, cleared, lang, businessId, basket, name);
  } else {
    const askId = await sendText(from, t('askName', lang));
    await setSession(from, { ...cleared, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
  }
}

async function sendOrderTypePrompt(from, lang, deliveryFee, body) {
  return sendButtonMessage(from, {
    body: body || t('askOrderType', lang, deliveryFee ?? 0),
    buttons: [
      { id: 'btn_pickup',   title: t('pickupBtn', lang) },
      { id: 'btn_delivery', title: t('deliveryBtn', lang) },
    ],
  });
}

// Renders the basket with a below-minimum warning (Confirm button hidden) or, once the
// subtotal meets minimumOrderValue, the plain basket with Confirm available again.
async function sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue }) {
  const subtotal = basketSubtotal(basket);
  const meets = !minimumOrderValue || subtotal >= minimumOrderValue;
  const buttons = basketViewButtons(lang, { includeConfirm: meets });
  const body = meets
    ? buildBasketText(basket, lang)
    : `${t('belowMinimumOrderValue', lang, minimumOrderValue.toFixed(2))}\n\n${buildBasketText(basket, lang)}`;
  const msgId = await sendButtonMessage(from, { body, buttons });
  return { msgId, meets };
}

// Shows the address picker (or asks for a typed/shared address) and transitions accordingly.
async function proceedToDeliveryAddress({ from, session, lang, businessId }) {
  const rows = await getDeliveryAddressRows(session, from, businessId, lang);
  if (rows) {
    const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
    await setSession(from, { ...session, state: 'awaiting_delivery_address_choice', orderType: 'delivery', pendingDeleteIds: pickerId ? [pickerId] : [] });
  } else {
    const askId = await sendText(from, t('askDeliveryAddress', lang));
    await setSession(from, { ...session, state: 'awaiting_delivery_address', orderType: 'delivery', pendingDeleteIds: askId ? [askId] : [] });
  }
}

// Called whenever a delivery order's basket may have changed (add more / re-submit cart)
// while still gated on minimumOrderValue (no deliveryAddress collected yet). Re-checks the
// minimum: if still short, re-shows the gate. If now met, resumes straight into address
// selection. Never re-asks pickup/delivery, since that's already answered.
async function resumeDeliveryCheckout({ from, session, lang, businessId, basket }) {
  const info = await getBusinessInfo(businessId);
  const subtotal = basketSubtotal(basket);
  if (info.minimumOrderValue && subtotal < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
    return;
  }
  await proceedToDeliveryAddress({ from, session, lang, businessId });
}

// Called right after a basket is confirmed (cart submit / "Confirm" tap). Skips straight to
// order-type selection (or name/confirmation) — notes are collected later via the "Add note"
// button on the final confirmation screen, not as a mandatory step here.
async function proceedFromConfirmedBasket({ from, session, lang, businessId, basket }) {
  const info = await getBusinessInfo(businessId);
  if (isConversationalBasket(info)) {
    await advanceCheckoutFromSlots({ from, session, lang, businessId, basket, info });
    return;
  }

  if (session.orderType === 'delivery') {
    await proceedToDeliveryAddress({ from, session, lang, businessId });
    return;
  }

  if (info.deliveryEnabled) {
    const typeId = await sendButtonMessage(from, {
      body: t('askOrderType', lang, info.deliveryFee ?? 0),
      buttons: [
        { id: 'btn_pickup',   title: t('pickupBtn', lang) },
        { id: 'btn_delivery', title: t('deliveryBtn', lang) },
      ],
    });
    await setSession(from, { ...session, state: 'awaiting_order_type', pendingDeleteIds: typeId ? [typeId] : [] });
    return;
  }

  const knownName = await getKnownName(from, businessId);
  if (knownName) {
    await transitionToConfirming(from, session, lang, businessId, basket, knownName);
  } else {
    const askId = await sendText(from, t('askName', lang));
    await setSession(from, { ...session, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
  }
}

/** M3: ask only missing checkout slots; profile pre-fill for returning customers. */
async function advanceCheckoutFromSlots({ from, session, lang, businessId, basket, info }) {
  const profile = await getCustomerProfile(from, businessId);
  let s = applyProfilePrefill(session, profile);

  if (!s.orderType && !isDeliveryOffered(info)) {
    s = { ...s, orderType: 'pickup' };
  }

  const missing = getMissingCheckoutSlots(s, info);

  if (missing.includes('orderType')) {
    const typeId = await sendOrderTypePrompt(from, lang, info.deliveryFee ?? 0);
    await setSession(from, { ...s, state: 'awaiting_order_type', pendingDeleteIds: typeId ? [typeId] : [] });
    return;
  }

  if (s.orderType === 'delivery') {
    const subtotal = basketSubtotal(basket);
    if (info.deliveryOpen === false) {
      const msgId = await sendButtonMessage(from, {
        body: t('deliveryClosedByOwner', lang),
        buttons: [{ id: 'btn_pickup', title: t('pickupBtn', lang) }],
      });
      await setSession(from, { ...s, pendingDeleteIds: msgId ? [msgId] : [] });
      return;
    }
    if (info.minimumOrderValue && subtotal < info.minimumOrderValue) {
      const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
      await setSession(from, {
        ...s,
        state: 'browsing',
        pendingDeleteIds: msgId ? [msgId] : [],
      });
      return;
    }
    if (missing.includes('deliveryAddress')) {
      await proceedToDeliveryAddress({ from, session: s, lang, businessId });
      return;
    }
  }

  if (missing.includes('customerName')) {
    const askId = await sendText(from, t('askName', lang));
    await setSession(from, { ...s, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
    return;
  }

  await transitionToConfirming(from, s, lang, businessId, basket, s.customerName);
}

// "View basket" while gated: re-renders the gate (Confirm shown only once minimumOrderValue
// is met) without advancing to the address step.
async function showDeliveryBasketGate({ from, session, lang, basket, businessId }) {
  const info = await getBusinessInfo(businessId);
  const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue || 0 });
  await setSession(from, { ...session, pendingDeleteIds: msgId ? [msgId] : [] });
}

function shouldShowOrderTypeRow(session, info) {
  if (session.orderType === 'pickup' || session.orderType === 'delivery') return true;
  return isDeliveryOffered(info);
}

function buildConfirmListRows(session, name, lang, info) {
  const deliveryOffered = shouldShowOrderTypeRow(session, info);
  const orderType = session.orderType || (deliveryOffered ? 'pickup' : null);

  const rows = [
    { id: 'btn_place_order', title: t('confirmBtn', lang) },
  ];
  if (deliveryOffered) {
    const typeDesc = orderType === 'delivery'
      ? t('confirmOrderTypeDelivery', lang)
      : t('confirmOrderTypePickup', lang);
    rows.push({
      id: 'confirm_edit_order_type',
      title: t('confirmEditOrderTypeBtn', lang),
      description: typeDesc.slice(0, 72),
    });
  }
  rows.push({ id: 'confirm_edit_name', title: t('confirmEditNameBtn', lang), description: name.slice(0, 72) });
  if (orderType === 'delivery') {
    const addrLabel = session.deliveryAddress || t('confirmNoAddressYet', lang);
    rows.push({
      id: 'confirm_edit_address',
      title: t('confirmEditAddressBtn', lang),
      description: addrLabel.slice(0, 72),
    });
  }
  rows.push({ id: 'btn_add_note', title: t('addNoteBtn', lang) });
  rows.push({ id: 'btn_back_to_cart', title: t('backToCartBtn', lang) });
  return rows;
}

async function sendConfirmList(from, session, lang, businessId, basket, name) {
  const info = await getBusinessInfo(businessId);
  const { total: displayTotal } = orderTotals(basket, session, info);
  const rows = buildConfirmListRows(session, name, lang, info);
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[checkout] confirm list ${businessId}: deliveryEnabled=${info.deliveryEnabled} orderType=${session.orderType ?? 'unset'} rows=${rows.map(r => r.id).join(',')}`);
  }
  return sendListMessage(from, {
    header: t('confirmListHeader', lang),
    body: t('finalConfirmBody', lang, name, displayTotal.toFixed(2), session.pickupTime, session.deliveryAddress ?? null, session.specialRequests || null, isPaymentEnabled(info) ? 'stripe' : null),
    buttonLabel: t('confirmListBtn', lang),
    sections: [{ title: t('confirmListSection', lang), rows }],
  });
}

// Sends the final confirmation message and sets state to 'confirming'.
// Call instead of transitioning to awaiting_name when a known name is available.
async function transitionToConfirming(from, session, lang, businessId, basket, name) {
  const info = await getBusinessInfo(businessId);
  const { subtotal } = orderTotals(basket, session, info);

  // Safety net: the delivery minimum gate normally runs earlier (btn_delivery /
  // resumeDeliveryCheckout), before the address is even asked. This re-check only
  // matters if the basket somehow changed after the gate already passed.
  if (session.orderType === 'delivery' && info.minimumOrderValue && subtotal < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
    return;
  }

  const confirmId = await sendConfirmList(from, session, lang, businessId, basket, name);
  await setSession(from, { ...session, state: 'confirming', customerName: name, pendingDeleteIds: confirmId ? [confirmId] : [] });
}

// Returns rows array when known addresses exist (lat/lng or saved profile address), null to skip picker.
async function getDeliveryAddressRows(session, phone, businessId, lang) {
  const rows = [];

  if (session.lat != null && session.lng != null) {
    const geocoded = await reverseGeocode(session.lat, session.lng);
    const label = geocoded || `${session.lat.toFixed(4)}, ${session.lng.toFixed(4)}`;
    rows.push({ id: 'delivery_loc_start', title: t('deliveryLocStart', lang), description: label.slice(0, 72) });
  }

  try {
    const snap = await customersRef(businessId).doc(phone).get();
    const saved = snap.data()?.lastDeliveryAddress;
    if (saved) {
      rows.push({ id: 'delivery_addr_saved', title: t('deliverySavedAddr', lang), description: saved.slice(0, 72) });
    }
  } catch { /* new customer or Firestore read error — skip saved option */ }

  if (!rows.length) return null;

  rows.push({ id: 'delivery_addr_new',   title: t('deliveryNewAddr',  lang) });
  rows.push({ id: 'delivery_addr_share', title: t('deliveryShareLoc', lang) });
  return rows;
}

async function sendDeliveryAddressPicker(to, rows, lang) {
  return sendListMessage(to, {
    header:      t('deliveryAddrPickerHeader', lang),
    body:        t('deliveryAddrPickerBody',   lang),
    buttonLabel: t('deliveryAddrPickerBtn',    lang),
    sections: [{ title: t('deliveryAddrSection', lang), rows }],
  });
}

function recomputePrepFields(info) {
  const prepMins = info.avgPrepTime || 30;
  const pickupTime = new Date(Date.now() + prepMins * 60000)
    .toLocaleTimeString('de-AT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: info.timezone || 'Europe/Vienna',
    });
  return { prepMins, pickupTime };
}

/** Re-show the current checkout prompt after a basket mutation (M2). */
async function reshowCheckoutPrompt(ctx, session, basket) {
  const { from, lang, businessId } = ctx;

  switch (session.state) {
    case 'awaiting_name': {
      const body = t('checkoutBasketUpdated', lang, buildBasketText(basket, lang));
      const askId = await sendText(from, `${body}\n\n${t('askName', lang)}`);
      await setSession(from, { ...session, basket, pendingDeleteIds: askId ? [askId] : [] });
      return;
    }
    case 'awaiting_order_type': {
      const info = await getBusinessInfo(businessId);
      const bodyPrefix = t('checkoutBasketUpdated', lang, buildBasketText(basket, lang));
      const msgId = await sendOrderTypePrompt(
        from,
        lang,
        info.deliveryFee ?? 0,
        session.confirmingOrderTypeEdit
          ? `${bodyPrefix}\n\n${t('askOrderTypeFromConfirm', lang)}`
          : `${bodyPrefix}\n\n${t('askOrderType', lang, info.deliveryFee ?? 0)}`,
      );
      await setSession(from, { ...session, basket, pendingDeleteIds: msgId ? [msgId] : [] });
      return;
    }
    case 'confirming':
      await transitionToConfirming(from, { ...session, basket }, lang, businessId, basket, session.customerName);
      return;
    case 'awaiting_confirm_note': {
      const askId = await sendText(from, t('addNotePrompt', lang));
      await setSession(from, { ...session, basket, pendingDeleteIds: askId ? [askId] : [] });
      return;
    }
    case 'awaiting_delivery_address': {
      const askId = await sendText(from, t('askDeliveryAddress', lang));
      await setSession(from, { ...session, basket, pendingDeleteIds: askId ? [askId] : [] });
      return;
    }
    case 'awaiting_delivery_address_choice': {
      const rows = await getDeliveryAddressRows(session, from, businessId, lang);
      if (rows) {
        const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
        await setSession(from, { ...session, basket, pendingDeleteIds: pickerId ? [pickerId] : [] });
      }
      return;
    }
    default:
      break;
  }
}

async function handleDeliveryMinimumAfterMutation(ctx, session, basket) {
  const { from, lang, businessId } = ctx;
  if (session.orderType !== 'delivery') return false;

  const info = await getBusinessInfo(businessId);
  if (!info.minimumOrderValue) return false;

  const subtotal = basketSubtotal(basket);
  if (subtotal >= info.minimumOrderValue) return false;

  const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
  await setSession(from, {
    ...session,
    basket,
    state: 'browsing',
    pendingDeleteIds: msgId ? [msgId] : [],
  });
  return true;
}

/**
 * M2 checkout text gate — basket ops, payment/order-type keywords, digit clarify, name/note guard.
 * @returns {Promise<boolean>} true when the message was consumed
 */
async function gateCheckoutTextInput(ctx) {
  const {
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  } = ctx;
  if (type !== 'text' || !text?.trim()) return false;

  const info = await getBusinessInfo(businessId);
  let liveSession = session;
  let menuTokens = null;
  if (isConversationalBasket(info)) {
    const { menuTokenIndex } = await getMenuContext(businessId);
    menuTokens = buildMenuFoodTokens(menuTokenIndex);
    liveSession = await tryApplyCheckoutSlotsFromText({
      from, session: liveSession, text, norm, business: info, menuTokens,
    });
    ctx.session = liveSession;
  }

  if (isBareCheckoutDigit(norm, liveSession.state)) {
    await sendText(from, t('checkoutDigitClarify', lang));
    return true;
  }

  if (liveSession.state === 'awaiting_order_type') {
    const orderType = parseOrderTypeKeyword(norm);
    if (orderType === 'pickup') {
      await handleAwaitingOrderType({ ...ctx, session: liveSession, type: 'button_reply', id: 'btn_pickup' });
      return true;
    }
    if (orderType === 'delivery') {
      await handleAwaitingOrderType({ ...ctx, session: liveSession, type: 'button_reply', id: 'btn_delivery' });
      return true;
    }
  }

  if (isConversationalBasket(info)) {
    const undoCtx = { hasUndoSnapshot: !!liveSession.basketUndoSnapshot?.basket };
    const cmd = await detectBotCommandAsync(text, {
      phone: from,
      hasUndoSnapshot: undoCtx.hasUndoSnapshot,
      hasBasket: basket.length > 0,
    });

    if (cmd?.command === BOT_COMMAND.UNDO || isBasketUndoPhrase(norm, undoCtx)) {
      const restored = await tryBasketUndo({
        from, session: liveSession, lang, businessId, basket, business: info, norm, silent: true,
      });
      if (restored === null) {
        await sendText(from, t('basketNothingToUndo', lang));
        return true;
      }
      if (Array.isArray(restored)) {
        const prepFields = recomputePrepFields(info);
        const newSession = { ...liveSession, ...prepFields, basket: restored };
        if (!restored.length) {
          await sendOrderEntryPrompt({
            from,
            session: { ...newSession, state: 'browsing', basket: [] },
            lang,
            businessId,
            basket: [],
            bodyOverride: t('basketEmpty', lang),
          });
          await setSession(from, {
            ...newSession,
            ...BASKET_CLEAR_PATCH,
            // undo consumed its snapshot — don't resurrect it from the stale session
            basketUndoSnapshot: undefined,
            basketPendingLearning: undefined,
            state: 'browsing',
            pendingDeleteIds: [],
          });
          return true;
        }
        if (await handleDeliveryMinimumAfterMutation(ctx, newSession, restored)) {
          return true;
        }
        await sendText(from, t('checkoutBasketUpdated', lang, buildBasketText(restored, lang)));
        await reshowCheckoutPrompt(ctx, newSession, restored);
        return true;
      }
    }

    // awaiting_confirm_note: any text is a free-form order note, not a product search.
    // awaiting_name: only run basket op for strong order text ("noch ein cola", "2 döner", etc.).
    const skipBasketOp = liveSession.state === 'awaiting_confirm_note'
      || (liveSession.state === 'awaiting_name' && !isStrongOrderText(text, norm));
    const opResult = skipBasketOp
      ? { handled: false }
      : await tryCheckoutBasketOp({
          from, session: liveSession, lang, businessId, basket, text, norm, business: info,
        });

    if (opResult.handled === 'llm_failed' || opResult.handled === 'no_match') {
      const foodText = stripCheckoutSlotsFromOrderText(text) || text;
      const body = opResult.handled === 'llm_failed'
        ? t('intentParseFailed', lang)
        : t('intentNoMatch', lang, foodText.trim());
      await sendText(from, body);
      await recordParseFailure({
        from, session: liveSession, lang, businessId, text: foodText, contactName,
      });
      return true;
    }

    if (opResult.handled) {
      if (opResult.basketCleared) {
        await sendOrderEntryPrompt({
          from,
          session: { ...opResult.session, state: 'browsing', basket: [] },
          lang,
          businessId,
          basket: [],
          bodyOverride: t('basketEmpty', lang),
        });
        await setSession(from, {
          ...opResult.session,
          ...BASKET_CLEAR_PATCH,
          state: 'browsing',
          pendingDeleteIds: [],
        });
        return true;
      }

      const newSession = opResult.session ?? liveSession;
      const newBasket = opResult.basket ?? basket;

      if (await handleDeliveryMinimumAfterMutation(ctx, newSession, newBasket)) {
        return true;
      }

      await resetParseFailures(from, liveSession);

      await patchSession(from, {
        ...recomputePrepFields(info),
        basket: newBasket,
      }, liveSession);

      await reshowCheckoutPrompt(ctx, { ...newSession, basket: newBasket }, newBasket);
      return true;
    }
  }

  if (liveSession.state === 'awaiting_name' && isStrongOrderText(text, norm)) {
    await sendText(from, t('checkoutNameNotOrder', lang));
    const askId = await sendText(from, t('askName', lang));
    await setSession(from, { ...liveSession, pendingDeleteIds: askId ? [askId] : [] });
    return true;
  }

  // Slot-only text ("zum Liefern", "Hauptstraße 5", "bar") must not become the
  // customer's name — the slots were already applied above, so just advance.
  if (liveSession.state === 'awaiting_name' && isConversationalBasket(info) && isCheckoutOnlySegment(text, menuTokens)) {
    await advanceCheckoutFromSlots({ from, session: liveSession, lang, businessId, basket, info });
    return true;
  }

  return false;
}

// Reached only via the "Add note" button on the final confirmation screen.
async function handleAwaitingConfirmNote({ from, session, lang, businessId, basket, type, text, norm, contactName, isMulti }) {
  if (await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  if (type === 'text' && norm.length > 0) {
    const newSession = { ...session, specialRequests: text.trim() };
    await transitionToConfirming(from, newSession, lang, businessId, basket, session.customerName);
    return;
  }
  await sendText(from, t('addNotePrompt', lang));
}

async function handleAwaitingOrderType({ from, session, lang, businessId, basket, type, id, text, norm, contactName, isMulti }) {
  if (type === 'text' && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  if (type === 'button_reply') {
    if (id === 'btn_pickup') {
      const newSession = { ...session, orderType: 'pickup', deliveryAddress: null };
      if (session.confirmingOrderTypeEdit) {
        await finishToConfirming(from, newSession, lang, businessId, basket);
        return;
      }
      const info = await getBusinessInfo(businessId);
      if (isConversationalBasket(info)) {
        await advanceCheckoutFromSlots({ from, session: newSession, lang, businessId, basket, info });
        return;
      }
      const knownName = await getKnownName(from, businessId);
      if (knownName) {
        await transitionToConfirming(from, newSession, lang, businessId, basket, knownName);
      } else {
        const askId = await sendText(from, t('askName', lang));
        await setSession(from, { ...newSession, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
      }
      return;
    }
    if (id === 'btn_delivery') {
      const delivInfo = await getBusinessInfo(businessId);
      if (delivInfo.deliveryOpen === false) {
        const msgId = await sendButtonMessage(from, {
          body: t('deliveryClosedByOwner', lang),
          buttons: [{ id: 'btn_pickup', title: t('pickupBtn', lang) }],
        });
        await setSession(from, { ...session, pendingDeleteIds: msgId ? [msgId] : [] });
        return;
      }
      const subtotal = basketSubtotal(basket);
      if (delivInfo.minimumOrderValue && subtotal < delivInfo.minimumOrderValue) {
        const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: delivInfo.minimumOrderValue });
        await setSession(from, {
          ...session,
          orderType: 'delivery',
          state: 'browsing',
          confirmingOrderTypeEdit: false,
          pendingDeleteIds: msgId ? [msgId] : [],
        });
        return;
      }
      await proceedToDeliveryAddress({ from, session: { ...session, orderType: 'delivery' }, lang, businessId });
      return;
    }
  }
  const info = await getBusinessInfo(businessId);
  await sendOrderTypePrompt(from, lang, info.deliveryFee ?? 0);
}

async function handleAwaitingDeliveryAddressChoice({ from, session, lang, businessId, basket, type, id, text, norm, contactName, isMulti }) {
  if (type === 'text' && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  if (type === 'list_reply') {
    if (id === 'delivery_loc_start' && session.lat != null && session.lng != null) {
      const geocoded = await reverseGeocode(session.lat, session.lng);
      const deliveryAddress = geocoded || `${session.lat.toFixed(4)}, ${session.lng.toFixed(4)}`;
      await finishToConfirming(from, { ...session, deliveryAddress }, lang, businessId, basket);
      return;
    }
    if (id === 'delivery_addr_saved') {
      try {
        const snap = await customersRef(businessId).doc(from).get();
        const deliveryAddress = snap.data()?.lastDeliveryAddress;
        if (deliveryAddress) {
          await finishToConfirming(from, { ...session, deliveryAddress }, lang, businessId, basket);
          return;
        }
      } catch { /* fall through to re-show picker */ }
    }
    if (id === 'delivery_addr_new') {
      const askId = await sendText(from, t('askDeliveryAddress', lang));
      await setSession(from, { ...session, state: 'awaiting_delivery_address', pendingDeleteIds: askId ? [askId] : [] });
      return;
    }
    if (id === 'delivery_addr_share') {
      const locId = await sendLocationRequest(from, t('askDeliveryAddress', lang));
      await setSession(from, { ...session, state: 'awaiting_delivery_address', pendingDeleteIds: locId ? [locId] : [] });
      return;
    }
  }
  // Re-show picker for any unrecognised input
  const rows = await getDeliveryAddressRows(session, from, businessId, lang);
  if (rows) {
    const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
    await setSession(from, { ...session, pendingDeleteIds: pickerId ? [pickerId] : [] });
  }
}

async function handleAwaitingDeliveryAddress({ from, session, lang, businessId, basket, type, text, norm, latitude, longitude, contactName, isMulti }) {
  if (type === 'text' && text?.trim() && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  let deliveryAddress = null;
  if (type === 'location' && latitude != null && longitude != null) {
    const geocoded = await reverseGeocode(latitude, longitude);
    deliveryAddress = geocoded || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  } else if (type === 'text' && norm.length > 0) {
    deliveryAddress = text.trim();
  }

  if (deliveryAddress) {
    await finishToConfirming(from, { ...session, deliveryAddress }, lang, businessId, basket);
    return;
  }
  await sendText(from, t('askDeliveryAddress', lang));
}

async function handleAwaitingName({ from, session, lang, businessId, basket, type, text, norm, contactName, isMulti }) {
  if (type === 'text' && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  if (type === 'text' && (isGreetingOnly(norm) || isFreshStartCommand(norm))) {
    const askId = await sendText(from, t('askName', lang));
    await setSession(from, { ...session, pendingDeleteIds: askId ? [askId] : [] });
    return;
  }

  if (type === 'text' && norm.length > 0) {
    const name = text.trim().slice(0, 60);
    const info = await getBusinessInfo(businessId);
    const newSession = { ...session, customerName: name };
    if (isConversationalBasket(info)) {
      await advanceCheckoutFromSlots({ from, session: newSession, lang, businessId, basket, info });
      return;
    }
    await transitionToConfirming(from, newSession, lang, businessId, basket, name);
    return;
  }
  await sendText(from, t('confirmSummary', lang, buildBasketText(basket, lang), session.prepMins, session.pickupTime));
}

async function handleConfirming({ from, contactName, session, lang, businessId, basket, isMulti, type, id, norm, text }) {
  if (type === 'text' && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  const replyId = (type === 'list_reply' || type === 'button_reply') ? id : null;
  const isConfirm = replyId === 'btn_place_order' || CONFIRM.has(norm);
  const isCancel  = replyId === 'btn_cancel_order' || CANCEL.has(norm);

  if (replyId === 'confirm_edit_name') {
    const askId = await sendText(from, t('askNameEdit', lang, session.customerName || ''));
    await setSession(from, { ...session, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
    return;
  }

  if (replyId === 'confirm_edit_order_type') {
    const info = await getBusinessInfo(businessId);
    if (!shouldShowOrderTypeRow(session, info)) {
      await transitionToConfirming(from, session, lang, businessId, basket, session.customerName);
      return;
    }
    const msgId = await sendOrderTypePrompt(from, lang, info.deliveryFee ?? 0, t('askOrderTypeFromConfirm', lang));
    await setSession(from, {
      ...session,
      state: 'awaiting_order_type',
      confirmingOrderTypeEdit: true,
      pendingDeleteIds: msgId ? [msgId] : [],
    });
    return;
  }

  if (replyId === 'confirm_edit_address') {
    await proceedToDeliveryAddress({ from, session: { ...session, orderType: 'delivery' }, lang, businessId });
    return;
  }

  if (replyId === 'btn_add_note') {
    const askId = await sendText(from, t('addNotePrompt', lang));
    await setSession(from, { ...session, state: 'awaiting_confirm_note', pendingDeleteIds: askId ? [askId] : [] });
    return;
  }

  if (replyId === 'btn_back_to_cart') {
    const msgId = await sendBasketView(from, lang, basket, session.specialRequests);
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
    return;
  }

  if (isConfirm) {
    const info = await getBusinessInfo(businessId);
    if (isPaymentEnabled(info)) {
      await placeOrderAndNotify({ from, session, lang, businessId, basket, isMulti, contactName, paymentMethod: 'stripe' });
      return;
    }
    logPaymentSkipped(businessId, info);
    await placeOrderAndNotify({ from, session, lang, businessId, basket, isMulti, contactName, paymentMethod: 'cash' });
    return;
  }

  if (isCancel) {
    if (isMulti) {
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [] });
      await sendText(from, t('checkoutCancelled', lang));
    } else {
      const { menuId } = await sendCatalog(from, lang, businessId, t('checkoutCancelled', lang));
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: menuId ? [menuId] : [] });
    }
    return;
  }

  await transitionToConfirming(from, session, lang, businessId, basket, session.customerName);
}

module.exports = {
  handleAwaitingConfirmNote,
  handleAwaitingOrderType,
  handleAwaitingDeliveryAddressChoice,
  handleAwaitingDeliveryAddress,
  handleAwaitingName,
  handleConfirming,
  resumeDeliveryCheckout,
  showDeliveryBasketGate,
  proceedFromConfirmedBasket,
};
