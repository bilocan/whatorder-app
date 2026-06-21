const { setSession } = require('../sessionStore');
const { sendText, sendButtonMessage, sendListMessage, sendLocationRequest, sendFlowMessage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { buildBasketText, sendCatalog } = require('../botHelpers');
const { getBusinessInfo } = require('../menuService');
const { createOrder } = require('../orderService');
const { customersRef } = require('../../lib/collections');
const { reverseGeocode } = require('../../lib/geocode');

const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', '1', 'ok', 'tamam', 'confirm', 'onayla', 'bestätigen', 'bestatigen']);
const CANCEL  = new Set(['no', 'hayır', 'hayir', 'nein', 'cancel', 'iptal', '2']);

async function getKnownName(phone, businessId) {
  try {
    const snap = await customersRef(businessId).doc(phone).get();
    const name = snap.data()?.name;
    return (name && name !== 'WhatsApp Customer') ? name : null;
  } catch {
    return null;
  }
}

// Renders the basket with a below-minimum warning (Confirm button hidden) or, once the
// subtotal meets minimumOrderValue, the plain basket with Confirm available again.
async function sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue }) {
  const subtotal = basket.reduce((s, i) => s + i.price * i.qty, 0);
  const meets = !minimumOrderValue || subtotal >= minimumOrderValue;
  const buttons = [
    { id: 'btn_add_more',     title: t('addMoreBtn', lang) },
    { id: 'btn_clear_basket', title: t('clearBasketBtn', lang) },
  ];
  if (meets) buttons.push({ id: 'btn_confirm', title: t('confirmBtn', lang) });
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
// minimum: if still short, re-shows the gate. If now met, re-asks special requests (the
// basket changed since the customer last answered that prompt — they may want to add a
// note for the new item) before resuming into address selection. Never re-asks
// pickup/delivery, since that's already answered.
async function resumeDeliveryCheckout({ from, session, lang, businessId, basket }) {
  const info = await getBusinessInfo(businessId);
  const subtotal = basket.reduce((s, i) => s + i.price * i.qty, 0);
  if (info.minimumOrderValue && subtotal < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
    return;
  }
  const reqId = await sendButtonMessage(from, {
    body: t('specialRequestsPrompt', lang),
    buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
  });
  await setSession(from, { ...session, state: 'awaiting_special_requests', pendingDeleteIds: reqId ? [reqId] : [] });
}

// "View basket" while gated: re-renders the gate (Confirm shown only once minimumOrderValue
// is met) without advancing to the address step.
async function showDeliveryBasketGate({ from, session, lang, basket, businessId }) {
  const info = await getBusinessInfo(businessId);
  const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue || 0 });
  await setSession(from, { ...session, pendingDeleteIds: msgId ? [msgId] : [] });
}

// Sends the final confirmation message and sets state to 'confirming'.
// Call instead of transitioning to awaiting_name when a known name is available.
async function transitionToConfirming(from, session, lang, businessId, basket, name) {
  const subtotal = basket.reduce((s, i) => s + i.price * i.qty, 0);
  const info = await getBusinessInfo(businessId);

  // Safety net: the delivery minimum gate normally runs earlier (btn_delivery /
  // resumeDeliveryCheckout), before the address is even asked. This re-check only
  // matters if the basket somehow changed after the gate already passed.
  if (session.orderType === 'delivery' && info.minimumOrderValue && subtotal < info.minimumOrderValue) {
    const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: info.minimumOrderValue });
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
    return;
  }

  const displayTotal = session.orderType === 'delivery' ? subtotal + (info.deliveryFee || 0) : subtotal;
  const confirmId = await sendButtonMessage(from, {
    body: t('finalConfirmBody', lang, name, displayTotal.toFixed(2), session.pickupTime, session.deliveryAddress ?? null),
    buttons: [
      { id: 'btn_place_order',  title: t('confirmOrderBtn', lang) },
      { id: 'btn_cancel_order', title: t('cancelOrderBtn', lang) },
    ],
  });
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

async function handleAwaitingSpecialRequests({ from, session, lang, businessId, basket, type, id, text, norm }) {
  if (type === 'button_reply' && id === 'btn_edit_cart') {
    await sendFlowMessage(from, {
      flowId: process.env.WHATSAPP_FLOW_ID || '1465498598663384',
      flowToken: `${from}|${businessId}`,
      flowCta: t('editCartBtn', lang),
      screen: 'CART_REVIEW',
      body: t('editCartBody', lang),
      data: {},
    });
    await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: [] });
    return;
  }

  const isSkip = type === 'button_reply' && id === 'btn_skip_requests';
  const notes = isSkip ? '' : (type === 'text' && norm.length > 0 ? text.trim() : null);

  if (notes !== null) {
    // Resumed after the delivery minimum gate: pickup/delivery is already answered
    // (this re-ask of special requests only happens because the basket changed).
    if (session.orderType === 'delivery') {
      await proceedToDeliveryAddress({ from, session: { ...session, specialRequests: notes }, lang, businessId });
      return;
    }

    const info = await getBusinessInfo(businessId);
    if (info.deliveryEnabled) {
      const typeId = await sendButtonMessage(from, {
        body: t('askOrderType', lang, info.deliveryFee ?? 0),
        buttons: [
          { id: 'btn_pickup',   title: t('pickupBtn', lang) },
          { id: 'btn_delivery', title: t('deliveryBtn', lang) },
        ],
      });
      await setSession(from, { ...session, state: 'awaiting_order_type', specialRequests: notes, pendingDeleteIds: typeId ? [typeId] : [] });
    } else {
      const newSession = { ...session, specialRequests: notes };
      const knownName = await getKnownName(from, businessId);
      if (knownName) {
        await transitionToConfirming(from, newSession, lang, businessId, basket, knownName);
      } else {
        const askId = await sendText(from, t('askName', lang));
        await setSession(from, { ...newSession, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
      }
    }
    return;
  }

  await sendButtonMessage(from, {
    body: t('specialRequestsPrompt', lang),
    buttons: [
      { id: 'btn_skip_requests', title: t('skipBtn', lang) },
      { id: 'btn_edit_cart',     title: t('editCartBtn', lang) },
    ],
  });
}

async function handleAwaitingOrderType({ from, session, lang, businessId, basket, type, id }) {
  if (type === 'button_reply') {
    if (id === 'btn_pickup') {
      const newSession = { ...session, orderType: 'pickup' };
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
      const subtotal = basket.reduce((s, i) => s + i.price * i.qty, 0);
      if (delivInfo.minimumOrderValue && subtotal < delivInfo.minimumOrderValue) {
        const { msgId } = await sendDeliveryBasketGate({ from, lang, basket, minimumOrderValue: delivInfo.minimumOrderValue });
        await setSession(from, { ...session, orderType: 'delivery', state: 'browsing', pendingDeleteIds: msgId ? [msgId] : [] });
        return;
      }
      await proceedToDeliveryAddress({ from, session, lang, businessId });
      return;
    }
  }
  const info = await getBusinessInfo(businessId);
  await sendButtonMessage(from, {
    body: t('askOrderType', lang, info.deliveryFee ?? 0),
    buttons: [
      { id: 'btn_pickup',   title: t('pickupBtn', lang) },
      { id: 'btn_delivery', title: t('deliveryBtn', lang) },
    ],
  });
}

async function handleAwaitingDeliveryAddressChoice({ from, session, lang, businessId, basket, type, id }) {
  if (type === 'list_reply') {
    if (id === 'delivery_loc_start' && session.lat != null && session.lng != null) {
      const geocoded = await reverseGeocode(session.lat, session.lng);
      const deliveryAddress = geocoded || `${session.lat.toFixed(4)}, ${session.lng.toFixed(4)}`;
      const newSession = { ...session, deliveryAddress };
      const knownName = await getKnownName(from, businessId);
      if (knownName) {
        await transitionToConfirming(from, newSession, lang, businessId, basket, knownName);
      } else {
        const askId = await sendText(from, t('askName', lang));
        await setSession(from, { ...newSession, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
      }
      return;
    }
    if (id === 'delivery_addr_saved') {
      try {
        const snap = await customersRef(businessId).doc(from).get();
        const profileData = snap.data();
        const deliveryAddress = profileData?.lastDeliveryAddress;
        if (deliveryAddress) {
          const newSession = { ...session, deliveryAddress };
          const knownName = profileData?.name && profileData.name !== 'WhatsApp Customer' ? profileData.name : null;
          if (knownName) {
            await transitionToConfirming(from, newSession, lang, businessId, basket, knownName);
          } else {
            const askId = await sendText(from, t('askName', lang));
            await setSession(from, { ...newSession, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
          }
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

async function handleAwaitingDeliveryAddress({ from, session, lang, businessId, basket, type, text, norm, latitude, longitude }) {
  let deliveryAddress = null;
  if (type === 'location' && latitude != null && longitude != null) {
    const geocoded = await reverseGeocode(latitude, longitude);
    deliveryAddress = geocoded || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
  } else if (type === 'text' && norm.length > 0) {
    deliveryAddress = text.trim();
  }

  if (deliveryAddress) {
    const newSession = { ...session, deliveryAddress };
    const knownName = await getKnownName(from, businessId);
    if (knownName) {
      await transitionToConfirming(from, newSession, lang, businessId, basket, knownName);
    } else {
      const askId = await sendText(from, t('askName', lang));
      await setSession(from, { ...newSession, state: 'awaiting_name', pendingDeleteIds: askId ? [askId] : [] });
    }
    return;
  }
  await sendText(from, t('askDeliveryAddress', lang));
}

async function handleAwaitingName({ from, session, lang, businessId, basket, type, text, norm }) {
  if (type === 'text' && norm.length > 0) {
    const name = text.trim().slice(0, 60);
    await transitionToConfirming(from, session, lang, businessId, basket, name);
    return;
  }
  await sendText(from, t('confirmSummary', lang, buildBasketText(basket, lang), session.prepMins, session.pickupTime));
}

async function handleConfirming({ from, contactName, session, lang, businessId, basket, isMulti, type, id, norm }) {
  const isConfirm = (type === 'button_reply' && id === 'btn_place_order') || CONFIRM.has(norm);
  const isCancel  = (type === 'button_reply' && id === 'btn_cancel_order') || CANCEL.has(norm);

  if (isConfirm) {
    const subtotal = basket.reduce((s, i) => s + i.price * i.qty, 0);
    const info = await getBusinessInfo(businessId);
    const isDelivery = session.orderType === 'delivery';
    const deliveryFee = isDelivery ? (info.deliveryFee || 0) : 0;
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
    });
    const shortId = orderId.slice(-6).toUpperCase();
    const orderTotal = isDelivery ? subtotal + deliveryFee : subtotal;
    const itemLines = basket.map(i => `• ${i.qty}× ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: isMulti ? null : businessId, pendingDeleteIds: [] });
    await sendText(from, t('orderReceipt', lang, shortId, info.name, itemLines, orderTotal.toFixed(2), session.pickupTime, session.customerName, session.deliveryAddress ?? null, info.alertPhone || null, info.address || null));
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

  await sendText(from, t('yesNoOnly', lang));
}

module.exports = {
  handleAwaitingSpecialRequests,
  handleAwaitingOrderType,
  handleAwaitingDeliveryAddressChoice,
  handleAwaitingDeliveryAddress,
  handleAwaitingName,
  handleConfirming,
  resumeDeliveryCheckout,
  showDeliveryBasketGate,
};
