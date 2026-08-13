const { setSession, patchSession } = require('../sessionStore');
const {
  sendText,
  sendButtonMessage,
  sendListMessage,
  sendFlowMessage,
  sendLocationRequest,
  sendCtaUrlMessage,
} = require('../../lib/whatsapp');
const { t } = require('../templates');
const {
  buildBasketText, sendCatalog, sendMenu, formatBasketItemsText, basketViewButtons, sendBasketView, parseBasketItemName,
} = require('../botHelpers');
const { getBusinessInfo, getMenuContext } = require('../menuService');
const { createOrder } = require('../orderService');
const { customersRef, ordersRef, menuRef } = require('../../lib/collections');
const { reverseGeocode, validateDeliveryAddress } = require('../../lib/geocode');
const {
  hasUnitPattern,
  normalizeBuildingLabel,
  composeDeliveryLabel,
  isDeliverableBuildingLabel,
  parseDeliveryUnit,
  splitStreetAndUnitHint,
  isNearlySameAddress,
} = require('../deliveryAddress');
const { isStripeConfigured } = require('../../lib/stripe');
const { createCheckoutSessionForOrder } = require('../../lib/paymentService');
const { isLegalComplete, missingLegalFields, isSettlementIbanComplete } = require('../../lib/legalProfile');
const { isPaymentEnabled } = require('../paymentGate');
const { buildOrderTaxSnapshot } = require('../../lib/receiptMath');
const { isStrongOrderText, isGreetingOnly, isFreshStartCommand } = require('../intentParser');
const { isConversationalBasket, isCheckoutConfirmFlow } = require('../featureFlags');
const { tryBasketUndo } = require('../conversationalBasket');
const {
  checkoutFlowToken,
  validateCheckoutSubmit,
  applyCheckoutSubmitToSession,
  buildCheckoutReviewData,
  buildConfirmFlowDraft,
  buildCheckoutSubmitPayloadFromSession,
  labelsByAddressChoice,
} = require('../checkoutConfirmFlow');
const { isBasketUndoPhrase, detectBotCommandAsync, detectBotCommandRules, BOT_COMMAND } = require('../botCommands');
const {
  parseOrderTypeKeyword,
  isBareCheckoutDigit,
  tryCheckoutBasketOp,
} = require('../checkoutOps');
const { BASKET_CLEAR_PATCH } = require('../basketOps');
const { FIELDS: F } = require('../../flows/fields');
const {
  applyProfilePrefill,
  getMissingCheckoutSlots,
  isFilledName,
  isDeliveryOffered,
  isCheckoutOnlySegment,
  stripCheckoutSlotsFromOrderText,
  tryApplyCheckoutSlotsFromText,
  buildMenuFoodTokens,
} = require('../checkoutSlots');
const { sendOrderEntryPrompt } = require('../orderEntry');
const { basketSubtotal, orderTotals } = require('../orderTotals');
const { loadCheckoutTotals, checkoutDealLines, chargedCustomerTotal } = require('../checkoutDeal');
const { recordParseFailure, resetParseFailures } = require('../postOrder');

// M2: bare `1` no longer confirms — use list row btn_place_order only (digit disambiguation).
const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', 'ok', 'tamam', 'confirm', 'onayla', 'bestätigen', 'bestatigen']);
// Whole-message only (norm). Clear/abort synonyms must cancel, not become confirm notes (e.g. "Löschen").
const CANCEL = new Set([
  'no', 'hayır', 'hayir', 'nein', 'cancel', 'iptal',
  'löschen', 'loschen', 'lösche', 'lösch',
  'clear', 'clear basket', 'clear all', 'delete', 'delete all',
  'abbrechen', 'abbruch',
  'alles löschen', 'alles loschen',
  'warenkorb leeren',
  'temizle', 'sepeti temizle', 'tümünü sil', 'tumunu sil', 'hepsini sil',
]);

function logPaymentSkipped(businessId, info) {
  if (info.paymentEnabled !== true) {
    console.warn(`[checkout] payment skipped for ${businessId}: paymentEnabled=${info.paymentEnabled ?? false}`);
  } else if (!isStripeConfigured()) {
    console.warn(`[checkout] payment skipped for ${businessId}: STRIPE_SECRET_KEY not set`);
  } else if (!isLegalComplete(info.legal)) {
    console.warn(`[checkout] payment skipped for ${businessId}: legal profile missing ${missingLegalFields(info.legal).join(', ')}`);
  } else if (!isSettlementIbanComplete(info.legal)) {
    console.warn(`[checkout] payment skipped for ${businessId}: settlement IBAN missing or invalid`);
  }
}

/**
 * Confirm → place. Card is mandatory: Stripe when the full payment gate passes, otherwise
 * soft-block with no order. There is no cash fallback.
 */
async function placeConfirmedOrder({ from, session, lang, businessId, basket, isMulti, contactName, info }) {
  if (isPaymentEnabled(info)) {
    await placeOrderAndNotify({
      from, session, lang, businessId, basket, isMulti, contactName, paymentMethod: 'stripe',
    });
    return;
  }

  logPaymentSkipped(businessId, info);
  const phoneNumberId = session.whatsappPhoneNumberId || null;
  await sendText(from, t('paymentLegalIncomplete', lang), phoneNumberId);
}

function normalizeMenuName(name) {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * Name keys to try for one basket line, most specific first. A customized line reads
 * `Item — Opt1, Opt2`, which never matches a menu name, so the base name is the fallback.
 */
function menuNameKeys(line) {
  const keys = [];
  const fullKey = normalizeMenuName(line?.name);
  if (fullKey) keys.push(fullKey);
  const baseKey = normalizeMenuName(parseBasketItemName(line ?? {}).baseName);
  if (baseKey && baseKey !== fullKey) keys.push(baseKey);
  return keys;
}

/**
 * Basket lines carry no vatRate — join the menu by item id, then by exact name, then by
 * the base name of a customized line. Reads the raw menu instead of `getMenuContext` so
 * an item that went unavailable while sitting in the basket still resolves its rate.
 */
async function attachMenuVatRates(businessId, basket) {
  const lines = basket ?? [];
  if (!lines.some(line => line.vatRate == null)) return lines;

  const snap = await menuRef(businessId).get();
  const menu = (snap.docs ?? []).map(doc => ({ ...doc.data(), id: doc.id }));
  const byId = new Map();
  const byName = new Map();
  // Available items are indexed first so they win a duplicate-name collision.
  for (const item of [...menu.filter(i => i.available !== false), ...menu.filter(i => i.available === false)]) {
    if (item?.id != null) byId.set(String(item.id), item);
    const nameKey = normalizeMenuName(item?.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, item);
  }

  return lines.map((line) => {
    if (line.vatRate != null) return line;
    const idKey = line.menuItemId ?? line.id;
    let match = idKey != null ? byId.get(String(idKey)) : null;
    for (const key of menuNameKeys(line)) {
      if (match) break;
      match = byName.get(key);
    }
    return match?.vatRate != null ? { ...line, vatRate: match.vatRate } : line;
  });
}

async function placeOrderAndNotify({ from, session, lang, businessId, basket, isMulti, contactName, paymentMethod }) {
  const info = await getBusinessInfo(businessId);
  const totals = await loadCheckoutTotals({
    businessId, info, customerPhone: from, basket, session,
  });
  const {
    subtotal, deliveryFee, discount, total, isDelivery,
  } = totals;
  const phoneNumberId = session.whatsappPhoneNumberId || null;

  // Card orders are blocked (order never created) when the Beleg / settlement data is not ready.
  let taxSnapshot = null;
  if (paymentMethod === 'stripe') {
    if (!isLegalComplete(info.legal)) {
      console.warn(`[checkout] card order blocked for ${businessId}: legal profile missing ${missingLegalFields(info.legal).join(', ')}`);
      await sendText(from, t('paymentLegalIncomplete', lang), phoneNumberId);
      return;
    }
    if (!isSettlementIbanComplete(info.legal)) {
      console.warn(`[checkout] card order blocked for ${businessId}: settlement IBAN missing or invalid`);
      await sendText(from, t('paymentLegalIncomplete', lang), phoneNumberId);
      return;
    }
    try {
      const lines = await attachMenuVatRates(businessId, basket);
      taxSnapshot = buildOrderTaxSnapshot(lines, {
        strict: true,
        deliveryFeeGross: deliveryFee,
        discountGross: discount,
      });
    } catch (err) {
      console.warn(`[checkout] card order blocked for ${businessId}: ${err.message}`);
      await sendText(from, t('paymentVatIncomplete', lang), phoneNumberId);
      return;
    }
  }

  const orderId = await createOrder(businessId, {
    customerPhone: from,
    customerName: session.customerName || contactName || null,
    restaurantName: info.name || null,
    items: basket,
    total: subtotal - discount,
    language: lang,
    pickupTime: isDelivery ? null : (session.pickupTime || null),
    notes: session.specialRequests || null,
    orderType: session.orderType || 'pickup',
    deliveryAddress: session.deliveryAddress || null,
    deliveryFee,
    discountSnapshot: totals.deal ? {
      discount,
      discountDealId: totals.deal.dealId,
      discountKind: totals.deal.kind,
      discountType: totals.deal.discountType,
      discountValue: totals.deal.discountValue,
      discountLabel: totals.deal.label,
    } : { discount: 0 },
    paymentMethod,
    paymentStatus: paymentMethod === 'stripe' ? 'pending' : 'cash',
    whatsappPhoneNumberId: session.whatsappPhoneNumberId || null,
    taxSnapshot,
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
    const chargedTotal = chargedCustomerTotal(taxSnapshot, total);
    try {
      const { url, sessionId } = await createCheckoutSessionForOrder(businessId, orderId, {
        totalEuros: chargedTotal,
        restaurantName: info.name,
        shortId,
        lang,
      });
      await ordersRef(businessId).doc(orderId).update({ paymentStripeSessionId: sessionId });
      await sendCtaUrlMessage(from, {
        body: t('paymentLink', lang, shortId, itemLines, chargedTotal.toFixed(2), info.name, info.alertPhone || null, info.address || null, isDelivery ? (session.deliveryAddress || null) : null, checkoutDealLines(t, lang, totals)),
        buttonLabel: t('payNowBtn', lang),
        url,
      }, phoneNumberId);
    } catch (err) {
      console.error('[payment] checkout session failed:', err.message);
      await sendText(from, t('paymentLinkFailed', lang, shortId), phoneNumberId);
    }
    return;
  }

  await sendText(from, t('orderReceipt', lang, shortId, info.name, itemLines, total.toFixed(2), session.pickupTime, session.customerName, session.deliveryAddress ?? null, paymentMethod, info.alertPhone || null, info.address || null, checkoutDealLines(t, lang, totals)), phoneNumberId);
  await sendButtonMessage(from, {
    body: t('postOrderOptions', lang, info.name),
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
      savedAddresses: Array.isArray(data.savedAddresses) ? data.savedAddresses : [],
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

function shouldSkipChatCheckoutSlots(info) {
  return isCheckoutConfirmFlow(info) && Boolean(process.env.WHATSAPP_CHECKOUT_FLOW_ID);
}

async function skipToConfirmingWithPrefill({
  from, session, lang, businessId, basket, businessInfo = null,
}) {
  const info = businessInfo ?? await getBusinessInfo(businessId);
  let s = { ...session };
  if (!s.orderType) {
    s = { ...s, orderType: isDeliveryOffered(info) ? 'delivery' : 'pickup' };
  }
  const profile = await getCustomerProfile(from, businessId);
  s = applyProfilePrefill(s, profile);
  await transitionToConfirming(
    from, s, lang, businessId, basket, s.customerName || '',
  );
}

async function finishToConfirming(from, session, lang, businessId, basket) {
  const info = await getBusinessInfo(businessId);
  const cleared = { ...session, confirmingOrderTypeEdit: false, pendingDeliveryBuilding: null };
  if (shouldSkipChatCheckoutSlots(info)) {
    await skipToConfirmingWithPrefill({
      from, session: cleared, lang, businessId, basket, businessInfo: info,
    });
    return;
  }
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

async function presentBuildingConfirm({ from, session, lang, building, lat, lng }) {
  const label = normalizeBuildingLabel(building);
  const msgId = await sendButtonMessage(from, {
    body: t('deliveryAddressConfirm', lang, label),
    buttons: [
      { id: 'btn_delivery_addr_yes', title: t('deliveryAddressConfirmYes', lang) },
      { id: 'btn_delivery_addr_edit', title: t('deliveryAddressConfirmEdit', lang) },
    ],
  });
  await setSession(from, {
    ...session,
    state: 'awaiting_delivery_address_confirm',
    pendingDeliveryBuilding: label,
    ...(lat != null && lng != null ? { lat, lng } : {}),
    pendingDeleteIds: msgId ? [msgId] : [],
  });
}

/**
 * Confirm when building was corrected OR when customer omitted PLZ.
 * With PLZ present and label nearly identical, skip Yes/Edit (Wien optional).
 * Without PLZ always confirm — Wien alone is not enough (ambiguous Hauptstraße).
 */
async function presentBuildingConfirmOrContinue({
  from, session, lang, businessId, basket, building, lat, lng, rawInput,
}) {
  const label = normalizeBuildingLabel(building);
  const inputHasPlz = /\b\d{4}\b/.test(String(rawInput || ''));
  if (rawInput && inputHasPlz && isNearlySameAddress(rawInput, label)) {
    await continueAfterBuildingAccepted({
      from, session, lang, businessId, basket, building: label, lat, lng,
    });
    return;
  }
  await presentBuildingConfirm({ from, session, lang, building: label, lat, lng });
}

async function presentUnitPrompt({ from, session, lang, building }) {
  const askId = await sendText(from, t('askDeliveryUnit', lang));
  await setSession(from, {
    ...session,
    state: 'awaiting_delivery_address_unit',
    pendingDeliveryBuilding: normalizeBuildingLabel(building),
    pendingDeleteIds: askId ? [askId] : [],
  });
}

/** After building is accepted: skip unit if already present, else ask Stiege/Tür/Top. */
async function continueAfterBuildingAccepted({ from, session, lang, businessId, basket, building, lat, lng }) {
  const label = normalizeBuildingLabel(building);
  const next = {
    ...session,
    pendingDeliveryBuilding: label,
    ...(lat != null && lng != null ? { lat, lng } : {}),
  };
  if (hasUnitPattern(label)) {
    await finishToConfirming(from, { ...next, deliveryAddress: label, pendingDeliveryBuilding: null }, lang, businessId, basket);
    return;
  }
  await presentUnitPrompt({ from, session: next, lang, building: label });
}

const EDIT_ADDRESS = new Set(['edit', 'ändern', 'andern', 'aendern', 'düzenle', 'duzenle', 'change', 'degistir', 'değiştir']);

async function resolveTypedDeliveryAddress(rawText) {
  const trimmed = rawText.trim();
  const { query, unitHint } = splitStreetAndUnitHint(trimmed);

  // Try building-only first; add Wien when locality missing (AT pilot default).
  const hasLocality = /\b(wien|vienna|\d{4})\b/i.test(query);
  const candidates = [];
  const push = (c) => {
    if (c && !candidates.includes(c)) candidates.push(c);
  };
  push(query);
  if (!hasLocality) push(`${query}, Wien`);
  if (query !== trimmed) push(trimmed);
  if (query !== trimmed && !/\b(wien|vienna|\d{4})\b/i.test(trimmed)) {
    push(`${query}, Wien`);
  }

  let validated = null;
  for (const candidate of candidates) {
    validated = await validateDeliveryAddress(candidate);
    if (validated?.formattedAddress && isDeliverableBuildingLabel(validated.formattedAddress)) {
      break;
    }
    validated = null;
  }

  if (!validated?.formattedAddress) {
    // Never accept unverified raw text (fake Hausnummer like "1111111" must fail).
    console.warn(`[checkout] delivery address unresolved: ${trimmed.slice(0, 80)}`);
    return { ok: false };
  }

  let building = normalizeBuildingLabel(validated.formattedAddress);
  if (unitHint) {
    building = composeDeliveryLabel(building, unitHint);
  }
  return {
    ok: true,
    building,
    lat: validated.lat ?? null,
    lng: validated.lng ?? null,
  };
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

// Always shows the address picker (with a pickup escape hatch) and transitions to choice state.
async function proceedToDeliveryAddress({ from, session, lang, businessId }) {
  const rows = await getDeliveryAddressRows(session, from, businessId, lang);
  const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
  await setSession(from, {
    ...session,
    state: 'awaiting_delivery_address_choice',
    orderType: 'delivery',
    pendingDeleteIds: pickerId ? [pickerId] : [],
  });
}

/**
 * Default delivery path: deliveryOpen + minimumOrderValue gates, then address picker.
 * Pickup is offered on the address picker (not as a prior step).
 */
async function beginDefaultDeliveryCheckout({ from, session, lang, businessId, basket }) {
  const info = await getBusinessInfo(businessId);
  const delivSession = { ...session, orderType: 'delivery' };

  if (info.deliveryOpen === false) {
    const msgId = await sendButtonMessage(from, {
      body: t('deliveryClosedByOwner', lang),
      buttons: [{ id: 'btn_pickup', title: t('pickupBtn', lang) }],
    });
    await setSession(from, {
      ...delivSession,
      state: 'awaiting_order_type',
      pendingDeleteIds: msgId ? [msgId] : [],
    });
    return;
  }

  const subtotal = basketSubtotal(basket);
  if (info.minimumOrderValue && subtotal < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({
      from, lang, basket, minimumOrderValue: info.minimumOrderValue,
    });
    await setSession(from, {
      ...delivSession,
      state: 'browsing',
      confirmingOrderTypeEdit: false,
      pendingDeleteIds: msgId ? [msgId] : [],
    });
    return;
  }

  if (shouldSkipChatCheckoutSlots(info)) {
    await skipToConfirmingWithPrefill({
      from, session: delivSession, lang, businessId, basket, businessInfo: info,
    });
    return;
  }

  await proceedToDeliveryAddress({ from, session: delivSession, lang, businessId });
}

/**
 * Delivery gates for an order type chosen inside the confirm Flow (no chat step ran them).
 * Mirrors `beginDefaultDeliveryCheckout`: paused delivery offers pickup, a basket below
 * minimumOrderValue drops back to browsing with the gated basket view.
 * Also blocks delivery when the restaurant does not offer it at all (`deliveryEnabled`).
 * @returns {Promise<boolean>} true when the submit was blocked and handled
 */
async function gateDeliverySubmit({ from, session, lang, basket, info }) {
  if (!isDeliveryOffered(info) || info.deliveryOpen === false) {
    const msgId = await sendButtonMessage(from, {
      body: t('deliveryClosedByOwner', lang),
      buttons: [{ id: 'btn_pickup', title: t('pickupBtn', lang) }],
    });
    await setSession(from, {
      ...session,
      state: 'awaiting_order_type',
      confirmingOrderTypeEdit: true,
      pendingDeleteIds: msgId ? [msgId] : [],
    });
    return true;
  }

  if (info.minimumOrderValue && basketSubtotal(basket) < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({
      from, lang, basket, minimumOrderValue: info.minimumOrderValue,
    });
    await setSession(from, {
      ...session,
      state: 'browsing',
      confirmingOrderTypeEdit: false,
      pendingDeleteIds: msgId ? [msgId] : [],
    });
    return true;
  }

  return false;
}

/** Switch to pickup and continue checkout (name / confirm). Shared by order-type + address-picker. */
async function applyPickupSelection({ from, session, lang, businessId, basket }) {
  const newSession = { ...session, orderType: 'pickup', deliveryAddress: null };
  if (session.confirmingOrderTypeEdit) {
    await finishToConfirming(from, newSession, lang, businessId, basket);
    return;
  }
  const info = await getBusinessInfo(businessId);
  if (shouldSkipChatCheckoutSlots(info)) {
    await skipToConfirmingWithPrefill({
      from, session: newSession, lang, businessId, basket, businessInfo: info,
    });
    return;
  }
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
}

// Called whenever a delivery order's basket may have changed (add more / re-submit cart)
// while still gated on minimumOrderValue (no deliveryAddress collected yet). Re-checks the
// minimum: if still short, re-shows the gate. If now met, resumes straight into address
// selection. Never re-asks pickup/delivery, since delivery is the default.
async function resumeDeliveryCheckout({ from, session, lang, businessId, basket }) {
  const info = await getBusinessInfo(businessId);
  const subtotal = basketSubtotal(basket);
  if (info.minimumOrderValue && subtotal < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
    return;
  }
  if (shouldSkipChatCheckoutSlots(info)) {
    await skipToConfirmingWithPrefill({
      from, session, lang, businessId, basket, businessInfo: info,
    });
    return;
  }
  await proceedToDeliveryAddress({ from, session, lang, businessId });
}

// Called right after a basket is confirmed (cart submit / "Confirm" tap). Defaults to
// delivery when offered (address picker includes pickup). Notes stay optional on confirm.
async function proceedFromConfirmedBasket({ from, session, lang, businessId, basket }) {
  const info = await getBusinessInfo(businessId);
  if (isConversationalBasket(info)) {
    await advanceCheckoutFromSlots({ from, session, lang, businessId, basket, info });
    return;
  }

  if (session.orderType === 'pickup') {
    if (shouldSkipChatCheckoutSlots(info)) {
      await skipToConfirmingWithPrefill({
        from, session, lang, businessId, basket, businessInfo: info,
      });
      return;
    }
    const knownName = await getKnownName(from, businessId);
    if (knownName) {
      await transitionToConfirming(from, session, lang, businessId, basket, knownName);
    } else {
      const askId = await sendText(from, t('askName', lang));
      await setSession(from, { ...session, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
    }
    return;
  }

  if (session.orderType === 'delivery' || info.deliveryEnabled) {
    await beginDefaultDeliveryCheckout({ from, session, lang, businessId, basket });
    return;
  }

  if (shouldSkipChatCheckoutSlots(info)) {
    await skipToConfirmingWithPrefill({
      from, session, lang, businessId, basket, businessInfo: info,
    });
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
  let s = { ...session };
  // Flow-on owns address collection, so it can safely prefill a saved delivery address after
  // defaulting the type. Flag-off keeps the legacy picker path when the type was still unset.
  if (shouldSkipChatCheckoutSlots(info) && !s.orderType) {
    s = { ...s, orderType: isDeliveryOffered(info) ? 'delivery' : 'pickup' };
  }
  const profile = await getCustomerProfile(from, businessId);
  s = applyProfilePrefill(s, profile);
  if (!s.orderType) {
    s = { ...s, orderType: isDeliveryOffered(info) ? 'delivery' : 'pickup' };
  }

  const missing = getMissingCheckoutSlots(s, info);

  if (s.orderType === 'delivery') {
    const subtotal = basketSubtotal(basket);
    if (info.deliveryOpen === false) {
      const msgId = await sendButtonMessage(from, {
        body: t('deliveryClosedByOwner', lang),
        buttons: [{ id: 'btn_pickup', title: t('pickupBtn', lang) }],
      });
      await setSession(from, {
        ...s,
        state: 'awaiting_order_type',
        pendingDeleteIds: msgId ? [msgId] : [],
      });
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
    if (shouldSkipChatCheckoutSlots(info)) {
      await transitionToConfirming(
        from, s, lang, businessId, basket, s.customerName || '',
      );
      return;
    }
    if (missing.includes('deliveryAddress')) {
      await proceedToDeliveryAddress({ from, session: s, lang, businessId });
      return;
    }
  }

  if (shouldSkipChatCheckoutSlots(info)) {
    await transitionToConfirming(
      from, s, lang, businessId, basket, s.customerName || '',
    );
    return;
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
  const orderType = session.orderType || (deliveryOffered ? 'delivery' : null);

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
  const totals = await loadCheckoutTotals({
    businessId, info, customerPhone: from, basket, session,
  });
  const rows = buildConfirmListRows(session, name, lang, info);
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[checkout] confirm list ${businessId}: deliveryEnabled=${info.deliveryEnabled} orderType=${session.orderType ?? 'unset'} rows=${rows.map(r => r.id).join(',')}`);
  }
  return sendListMessage(from, {
    header: t('confirmListHeader', lang),
    body: buildFinalConfirmBody(session, lang, name, info, totals),
    buttonLabel: t('confirmListBtn', lang),
    sections: [{ title: t('confirmListSection', lang), rows }],
  });
}

function buildFinalConfirmBody(session, lang, name, info, totals) {
  const discountLine = checkoutDealLines(t, lang, totals);
  return t(
    'finalConfirmBody',
    lang,
    name || session.customerName,
    totals.total.toFixed(2),
    session.pickupTime,
    session.deliveryAddress ?? null,
    session.specialRequests || null,
    isPaymentEnabled(info) ? 'stripe' : null,
    discountLine,
  );
}

/** Chat gate before the Flow CTA (Add more / Continue). Meta cannot put extra buttons on a Flow message. */
async function sendConfirmFlowGate(from, session, lang, businessId, basket, name, info) {
  const totals = await loadCheckoutTotals({
    businessId, info, customerPhone: from, basket, session,
  });
  return sendButtonMessage(from, {
    body: buildFinalConfirmBody(session, lang, name, info, totals),
    buttons: [
      { id: 'btn_confirm_add_more', title: t('confirmGateAddMore', lang) },
      { id: 'btn_confirm_continue', title: t('confirmGateContinue', lang) },
    ],
  });
}

// flow_action `navigate` never calls the endpoint INIT, so the screen renders empty unless
// the prefill ships inside flow_action_payload.data (see sendFlowMessage).
async function sendCheckoutConfirmFlow(from, session, lang, businessId, basket, name, info) {
  const reviewSession = { ...session, customerName: name || session.customerName };
  const totals = await loadCheckoutTotals({
    businessId, info, customerPhone: from, basket, session: reviewSession,
  });
  const profile = await getCustomerProfile(from, businessId);
  return sendFlowMessage(from, {
    flowId: process.env.WHATSAPP_CHECKOUT_FLOW_ID,
    flowToken: checkoutFlowToken(from, businessId),
    flowCta: t('confirmFlowCta', lang),
    screen: 'CHECKOUT_REVIEW',
    body: buildFinalConfirmBody(session, lang, name, info, totals),
    data: buildCheckoutReviewData({
      session: reviewSession,
      basket,
      info,
      lang,
      t,
      savedAddresses: [
        ...(profile?.savedAddresses || []),
        profile?.lastDeliveryAddress,
      ].filter(Boolean),
      defaultAddress: profile?.lastDeliveryAddress || '',
      deal: totals.deal,
    }),
  });
}

/**
 * @param {'gate'|'flow'} flowUiMode
 *   gate = first entry (Add more / Continue). flow = after Continue / validation re-offer.
 */
async function sendConfirmUi(
  from, session, lang, businessId, basket, name, businessInfo = null, flowUiMode = 'gate',
) {
  const info = businessInfo ?? await getBusinessInfo(businessId);
  const wantFlow = shouldSkipChatCheckoutSlots(info);
  let msgId = null;

  if (wantFlow && flowUiMode === 'gate') {
    msgId = await sendConfirmFlowGate(from, session, lang, businessId, basket, name, info);
    // Gate message is the success path even when the WA id is falsy (same as list).
    return { msgId, deferredChatLadder: false };
  }

  if (wantFlow && flowUiMode === 'flow') {
    try {
      msgId = await sendCheckoutConfirmFlow(from, session, lang, businessId, basket, name, info);
    } catch (err) {
      console.warn('[checkout] confirm Flow send failed', err.message);
    }
  }
  if (msgId) {
    return { msgId, deferredChatLadder: false };
  }

  // Flow-mode send failed (or gate somehow failed): never Optionen-place with empty delivery fields.
  if (wantFlow && session.orderType === 'delivery' && !String(session.deliveryAddress || '').trim()) {
    await proceedToDeliveryAddress({ from, session, lang, businessId });
    return { msgId: null, deferredChatLadder: true };
  }

  if (wantFlow && !isFilledName(session.customerName || name)) {
    const askId = await sendText(from, t('askName', lang));
    await setSession(from, {
      ...session,
      customerName: name || session.customerName,
      state: 'awaiting_name',
      pendingDeleteIds: askId ? [askId] : [],
    });
    return { msgId: null, deferredChatLadder: true };
  }

  msgId = await sendConfirmList(from, session, lang, businessId, basket, name);
  return { msgId, deferredChatLadder: false };
}

async function offerCheckoutConfirmFlow(from, session, lang, businessId, basket, name) {
  const info = await getBusinessInfo(businessId);
  const { msgId, deferredChatLadder } = await sendConfirmUi(
    from, session, lang, businessId, basket, name, info, 'flow',
  );
  if (deferredChatLadder) return;
  await patchSession(from, {
    state: 'confirming',
    customerName: name || session.customerName,
    pendingDeleteIds: msgId ? [msgId] : [],
  });
}

// `confirmFlowDraft` is not a persisted session field (see sessionStore whitelist), so it
// survives exactly one re-offer and is dropped by the next session write — place, back to
// cart, or any other transition all clear it without extra bookkeeping.
async function reofferConfirming(from, session, lang, businessId, basket) {
  // After the customer already chose Continue (or failed Flow submit), re-offer the Flow
  // message — not the Add more / Continue gate — to avoid a third tap.
  const { msgId, deferredChatLadder } = await sendConfirmUi(
    from, session, lang, businessId, basket, session.customerName, null, 'flow',
  );
  if (deferredChatLadder) return;
  await patchSession(from, {
    state: 'confirming',
    ...(session.confirmFlowDraft ? { confirmFlowDraft: session.confirmFlowDraft } : {}),
    pendingDeleteIds: msgId ? [msgId] : [],
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

  const { msgId, deferredChatLadder } = await sendConfirmUi(
    from, session, lang, businessId, basket, name, info, 'gate',
  );
  if (deferredChatLadder) return;
  await setSession(from, {
    ...session,
    state: 'confirming',
    customerName: name,
    pendingDeleteIds: msgId ? [msgId] : [],
  });
}

// Address picker rows. Always includes enter/share + pickup escape (delivery is the default path).
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

  rows.push({ id: 'delivery_addr_new', title: t('deliveryNewAddr', lang) });
  rows.push({ id: 'delivery_addr_share', title: t('deliveryShareLoc', lang) });
  rows.push({
    id: 'delivery_addr_pickup',
    title: t('deliveryPickupOption', lang),
    description: t('deliveryPickupOptionDesc', lang).slice(0, 72),
  });
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
      const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
      await setSession(from, { ...session, basket, pendingDeleteIds: pickerId ? [pickerId] : [] });
      return;
    }
    case 'awaiting_delivery_address_confirm': {
      if (session.pendingDeliveryBuilding) {
        await presentBuildingConfirm({
          from, session, lang,
          building: session.pendingDeliveryBuilding,
          lat: session.lat, lng: session.lng,
        });
      }
      return;
    }
    case 'awaiting_delivery_address_unit': {
      const askId = await sendText(from, t('askDeliveryUnit', lang));
      await setSession(from, { ...session, basket, pendingDeleteIds: askId ? [askId] : [] });
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

  if (liveSession.state === 'awaiting_delivery_address_choice') {
    if (parseOrderTypeKeyword(norm) === 'pickup') {
      await handleAwaitingDeliveryAddressChoice({
        ...ctx, session: liveSession, type: 'list_reply', id: 'delivery_addr_pickup',
      });
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

    // awaiting_confirm_note / confirming: weak free text is a note, not a product search.
    // awaiting_name: only run basket op for strong order text ("noch ein cola", "2 döner", etc.).
    // awaiting_delivery_address*: typed text is always the address / unit, never a menu search.
    const skipBasketOp = liveSession.state === 'awaiting_confirm_note'
      || liveSession.state === 'awaiting_delivery_address'
      || liveSession.state === 'awaiting_delivery_address_choice'
      || liveSession.state === 'awaiting_delivery_address_confirm'
      || liveSession.state === 'awaiting_delivery_address_unit'
      || (liveSession.state === 'confirming' && !isStrongOrderText(text, norm))
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
      await applyPickupSelection({ from, session, lang, businessId, basket });
      return;
    }
    if (id === 'btn_delivery') {
      await beginDefaultDeliveryCheckout({ from, session, lang, businessId, basket });
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
    if (id === 'delivery_addr_pickup') {
      await applyPickupSelection({ from, session, lang, businessId, basket });
      return;
    }
    if (id === 'delivery_loc_start' && session.lat != null && session.lng != null) {
      const geocoded = await reverseGeocode(session.lat, session.lng);
      if (!geocoded || !isDeliverableBuildingLabel(geocoded)) {
        const askId = await sendText(from, t('deliveryAddressGeocodeFailed', lang));
        await setSession(from, { ...session, state: 'awaiting_delivery_address', pendingDeleteIds: askId ? [askId] : [] });
        return;
      }
      await presentBuildingConfirm({
        from, session, lang, building: geocoded, lat: session.lat, lng: session.lng,
      });
      return;
    }
    if (id === 'delivery_addr_saved') {
      try {
        const snap = await customersRef(businessId).doc(from).get();
        const deliveryAddress = snap.data()?.lastDeliveryAddress;
        if (deliveryAddress) {
          await continueAfterBuildingAccepted({
            from, session, lang, businessId, basket, building: deliveryAddress,
          });
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
      const locId = await sendLocationRequest(from, t('askDeliveryAddressShare', lang));
      await setSession(from, { ...session, state: 'awaiting_delivery_address', pendingDeleteIds: locId ? [locId] : [] });
      return;
    }
  }
  // Re-show picker for any unrecognised input
  const rows = await getDeliveryAddressRows(session, from, businessId, lang);
  const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
  await setSession(from, { ...session, pendingDeleteIds: pickerId ? [pickerId] : [] });
}

async function handleAwaitingDeliveryAddress({ from, session, lang, businessId, basket, type, text, norm, latitude, longitude, contactName, isMulti }) {
  if (type === 'text' && text?.trim() && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  if (type === 'location' && latitude != null && longitude != null) {
    const geocoded = await reverseGeocode(latitude, longitude);
    if (!geocoded || !isDeliverableBuildingLabel(geocoded)) {
      await sendText(from, t('deliveryAddressGeocodeFailed', lang));
      return;
    }
    await presentBuildingConfirm({
      from, session, lang, building: geocoded, lat: latitude, lng: longitude,
    });
    return;
  }

  if (type === 'text' && norm.length > 0) {
    const resolved = await resolveTypedDeliveryAddress(text);
    if (!resolved.ok) {
      await sendText(from, t('deliveryAddressInvalid', lang));
      return;
    }
    await presentBuildingConfirmOrContinue({
      from, session, lang, businessId, basket,
      building: resolved.building,
      lat: resolved.lat,
      lng: resolved.lng,
      rawInput: text.trim(),
    });
    return;
  }
  await sendText(from, t('askDeliveryAddress', lang));
}

async function handleAwaitingDeliveryAddressConfirm({ from, session, lang, businessId, basket, type, id, text, norm, contactName, isMulti }) {
  if (type === 'text' && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  const building = session.pendingDeliveryBuilding;
  const accepted =
    (type === 'button_reply' && id === 'btn_delivery_addr_yes')
    || (type === 'text' && CONFIRM.has(norm));
  const edit =
    (type === 'button_reply' && id === 'btn_delivery_addr_edit')
    || (type === 'text' && EDIT_ADDRESS.has(norm));

  if (edit) {
    const askId = await sendText(from, t('askDeliveryAddress', lang));
    await setSession(from, {
      ...session,
      state: 'awaiting_delivery_address',
      pendingDeliveryBuilding: null,
      pendingDeleteIds: askId ? [askId] : [],
    });
    return;
  }

  if (accepted && building) {
    await continueAfterBuildingAccepted({
      from, session, lang, businessId, basket, building, lat: session.lat, lng: session.lng,
    });
    return;
  }

  if (building) {
    await presentBuildingConfirm({
      from, session, lang, building, lat: session.lat, lng: session.lng,
    });
    return;
  }
  const askId = await sendText(from, t('askDeliveryAddress', lang));
  await setSession(from, { ...session, state: 'awaiting_delivery_address', pendingDeleteIds: askId ? [askId] : [] });
}

async function handleAwaitingDeliveryAddressUnit({ from, session, lang, businessId, basket, type, text, norm, contactName, isMulti }) {
  if (type === 'text' && text?.trim() && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  const building = session.pendingDeliveryBuilding;
  if (!building) {
    const askId = await sendText(from, t('askDeliveryAddress', lang));
    await setSession(from, { ...session, state: 'awaiting_delivery_address', pendingDeleteIds: askId ? [askId] : [] });
    return;
  }

  if (type === 'text' && norm.length > 0) {
    const parsed = parseDeliveryUnit(text);
    if (!parsed.ok) {
      await sendText(from, t('deliveryUnitInvalid', lang));
      return;
    }
    const deliveryAddress = parsed.label == null
      ? normalizeBuildingLabel(building)
      : composeDeliveryLabel(building, parsed.label);
    await finishToConfirming(from, {
      ...session,
      deliveryAddress,
      pendingDeliveryBuilding: null,
    }, lang, businessId, basket);
    return;
  }
  await sendText(from, t('askDeliveryUnit', lang));
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

  // Checkout keywords (fertig / done / tamam) are not names — re-ask.
  if (type === 'text' && detectBotCommandRules(text)?.command === BOT_COMMAND.CONFIRM_CHECKOUT) {
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

async function handleConfirming({
  from, contactName, session, lang, businessId, basket, isMulti, type, id, norm, text, data,
}) {
  if (type === 'text' && await gateCheckoutTextInput({
    from, session, lang, businessId, basket, type, text, norm, contactName, isMulti,
  })) return;

  if (type === 'flow_completion') {
    const payload = data ?? {};
    if (payload.checkout_action === 'back_to_cart') {
      const msgId = await sendBasketView(from, lang, basket, session.specialRequests);
      await patchSession(from, {
        state: 'browsing',
        pendingDeleteIds: msgId ? [msgId] : [],
      });
      return;
    }

    const hasCheckoutFields = [
      F.CUSTOMER_NAME, F.ORDER_TYPE, F.ADDRESS_CHOICE, F.DELIVERY_ADDRESS, F.DELIVERY_APARTMENT, F.CHECKOUT_NOTE,
    ].some(field => Object.prototype.hasOwnProperty.call(payload, field));
    if (payload.checkout_action !== 'place_order' && !hasCheckoutFields) {
      await reofferConfirming(from, session, lang, businessId, basket);
      return;
    }

    const profile = await getCustomerProfile(from, businessId);
    const addressLabels = labelsByAddressChoice(
      profile?.savedAddresses || [],
      session.deliveryAddress || profile?.lastDeliveryAddress || '',
      lang,
      t,
      profile?.lastDeliveryAddress || '',
    );
    const validation = validateCheckoutSubmit(payload, { addressLabels });
    if (!validation.ok) {
      await sendText(from, t(validation.errorKey, lang));
      await reofferConfirming(
        from,
        { ...session, confirmFlowDraft: buildConfirmFlowDraft(payload) },
        lang, businessId, basket,
      );
      return;
    }

    if (!Array.isArray(basket) || basket.length === 0) {
      const nextSession = { ...session, state: 'browsing', basket: [] };
      await sendOrderEntryPrompt({
        from,
        session: nextSession,
        lang,
        businessId,
        bodyOverride: t('basketEmpty', lang),
      });
      await setSession(from, { ...nextSession, pendingDeleteIds: [] });
      return;
    }

    const submittedSession = applyCheckoutSubmitToSession(session, validation.values);
    const info = await getBusinessInfo(businessId);
    // A pickup → delivery switch inside the Flow skipped the chat gates, so re-run them
    // here: an order that could never be delivered must not be placed.
    if (submittedSession.orderType === 'delivery'
      && await gateDeliverySubmit({ from, session: submittedSession, lang, basket, info })) {
      return;
    }
    await placeConfirmedOrder({
      from, session: submittedSession, lang, businessId, basket, isMulti, contactName, info,
    });
    return;
  }

  const replyId = (type === 'list_reply' || type === 'button_reply') ? id : null;
  const isConfirm = replyId === 'btn_place_order'
    || CONFIRM.has(norm)
    || detectBotCommandRules(text)?.command === BOT_COMMAND.CONFIRM_CHECKOUT;
  const isCancel = replyId === 'btn_cancel_order'
    || replyId === 'btn_clear_basket'
    || CANCEL.has(norm);

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
    await patchSession(from, {
      state: 'browsing',
      confirmFlowDraft: null,
      pendingDeleteIds: msgId ? [msgId] : [],
    });
    return;
  }

  // Confirm gate "Add more": open menu/catalog directly (do not bounce through basket view,
  // which also has Mehr hinzufügen).
  if (replyId === 'btn_confirm_add_more') {
    const next = {
      ...session,
      state: 'browsing',
      confirmFlowDraft: null,
      pendingDeleteIds: [],
    };
    await setSession(from, next);
    if (session.flow === 'list') {
      const { menuId, textMenuIndex, textMenuCategory } = await sendMenu(from, lang, businessId);
      await patchSession(from, { menuId, textMenuIndex, textMenuCategory }, next);
    } else {
      const { menuId, textMenuIndex, textMenuCategory } = await sendCatalog(from, lang, businessId);
      await patchSession(from, { menuId, textMenuIndex, textMenuCategory }, next);
    }
    return;
  }

  if (replyId === 'btn_confirm_continue') {
    await offerCheckoutConfirmFlow(
      from, session, lang, businessId, basket, session.customerName,
    );
    return;
  }

  if (isConfirm) {
    const info = await getBusinessInfo(businessId);
    if (shouldSkipChatCheckoutSlots(info)) {
      const payload = buildCheckoutSubmitPayloadFromSession(session);
      const validation = validateCheckoutSubmit(payload);
      if (!validation.ok) {
        await sendText(from, t(validation.errorKey, lang));
        await reofferConfirming(from, session, lang, businessId, basket);
        return;
      }
      if (!Array.isArray(basket) || basket.length === 0) {
        const nextSession = { ...session, state: 'browsing', basket: [] };
        await sendOrderEntryPrompt({
          from,
          session: nextSession,
          lang,
          businessId,
          bodyOverride: t('basketEmpty', lang),
        });
        await setSession(from, { ...nextSession, pendingDeleteIds: [] });
        return;
      }
      const submittedSession = applyCheckoutSubmitToSession(session, validation.values);
      if (submittedSession.orderType === 'delivery'
        && await gateDeliverySubmit({ from, session: submittedSession, lang, basket, info })) {
        return;
      }
      await placeConfirmedOrder({
        from, session: submittedSession, lang, businessId, basket, isMulti, contactName, info,
      });
      return;
    }
    await placeConfirmedOrder({ from, session, lang, businessId, basket, isMulti, contactName, info });
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

  // Free text on the confirm screen (without tapping Add note) — e.g. "kola kalt bitte".
  if (type === 'text' && norm.length > 0) {
    const newSession = { ...session, specialRequests: text.trim() };
    await transitionToConfirming(from, newSession, lang, businessId, basket, session.customerName);
    return;
  }

  await transitionToConfirming(from, session, lang, businessId, basket, session.customerName);
}

module.exports = {
  handleAwaitingConfirmNote,
  handleAwaitingOrderType,
  handleAwaitingDeliveryAddressChoice,
  handleAwaitingDeliveryAddress,
  handleAwaitingDeliveryAddressConfirm,
  handleAwaitingDeliveryAddressUnit,
  handleAwaitingName,
  handleConfirming,
  resumeDeliveryCheckout,
  showDeliveryBasketGate,
  proceedFromConfirmedBasket,
};
