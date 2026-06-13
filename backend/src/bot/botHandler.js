const { getSession, setSession } = require('./sessionStore');
const { getMenu, getBusinessInfo } = require('./menuService');
const { createOrder } = require('./orderService');
const { sendText, sendListMessage, sendButtonMessage, sendCatalogMessage, sendLocationRequest, deleteMessage } = require('../lib/whatsapp');
const { sortByDistance } = require('../lib/distance');
const { detectLanguage, scoreLanguage, getOverride } = require('./languageDetector');
const { t, tCategory } = require('./templates');
const { reverseGeocode } = require('../lib/geocode');
const { customersRef } = require('../lib/collections');
const { isOpenNow, isOrderingOpen, getTodayOrderWindow } = require('../lib/schedule');

const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', '1', 'ok', 'tamam', 'confirm', 'onayla', 'bestätigen', 'bestatigen']);
const CANCEL  = new Set(['no', 'hayır', 'hayir', 'nein', 'cancel', 'iptal', '2']);
const BASKET_KEYWORDS = new Set(['basket', 'sepet', 'warenkorb']);
const SWITCH_KEYWORDS = new Set(['switch', 'change', 'restaurants', 'back', 'home', 'wechseln', 'zurück', 'zuruck', 'değiştir', 'degistir', 'restoranlar', 'start']);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h safety net for abandoned browsing sessions

function buildMenuSections(menu, lang) {
  const grouped = {};
  for (const item of menu) {
    const cat = item.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(item);
  }
  const sections = [];
  let totalRows = 0;
  for (const [cat, items] of Object.entries(grouped)) {
    if (totalRows >= 10) break;
    const allowed = Math.min(items.length, 10 - totalRows);
    const rows = items.slice(0, allowed).map(item => ({
      id: `item_${item.id}`,
      title: item.name.slice(0, 24),
      description: `€${Number(item.price).toFixed(2)}${item.description ? ` · ${item.description}` : ''}`.slice(0, 72),
    }));
    totalRows += rows.length;
    sections.push({ title: tCategory(cat, lang).slice(0, 24), rows });
  }
  return sections;
}

function buildBasketText(basket, lang) {
  const lines = basket.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`);
  const total = basket.reduce((s, i) => s + i.price * i.qty, 0);
  return `${t('basketHeader', lang)}\n\n${lines.join('\n')}\n\n${t('orderTotal', lang, total.toFixed(2))}`;
}

async function sendMenu(to, lang, businessId, bodyOverride) {
  const [info, menu] = await Promise.all([getBusinessInfo(businessId), getMenu(businessId)]);
  if (!menu.length) {
    await sendText(to, t('menuEmpty', lang));
    return null;
  }
  return sendListMessage(to, {
    header: t('menuListHeader', lang, info.name),
    body: bodyOverride ?? t('menuListBody', lang),
    footer: t('menuListFooter', lang),
    buttonLabel: t('viewMenuBtn', lang),
    sections: buildMenuSections(menu, lang),
  });
}

// Tries catalog message; falls back to list menu if catalog is unavailable or rejected.
// Returns the list menu message ID when the list fallback is used, null for catalog sends.
async function sendCatalog(to, lang, businessId, bodyOverride) {
  const [info, menu] = await Promise.all([getBusinessInfo(businessId), getMenu(businessId)]);
  if (!info.catalogId || !menu.length) {
    return sendMenu(to, lang, businessId, bodyOverride);
  }
  try {
    await sendCatalogMessage(to, info.catalogId, bodyOverride ?? t('catalogBody', lang, info.name), menu[0].id);
    return null;
  } catch {
    return sendMenu(to, lang, businessId, bodyOverride);
  }
}

async function getBusinessesInfo(businessIds) {
  return Promise.all(businessIds.map(async bid => {
    const info = await getBusinessInfo(bid);
    const tz = info.timezone || 'Europe/Vienna';
    return { id: bid, name: info.name, tagline: info.tagline || info.cuisine || '', lat: info.lat ?? null, lng: info.lng ?? null, isOpen: isOpenNow(info.schedule, tz) };
  }));
}

async function sendRestaurantPicker(to, businesses, lang) {
  return sendListMessage(to, {
    header: 'WhatOrder',
    body: t('restaurantPickerBody', lang),
    footer: t('restaurantPickerFooter', lang),
    buttonLabel: t('restaurantPickerButton', lang),
    sections: [{
      title: 'Restaurants',
      rows: businesses.map(b => {
        const distLabel = b.distanceKm != null
          ? (b.distanceKm < 1
              ? `📍 ${Math.round(b.distanceKm * 1000)} m`
              : `📍 ${b.distanceKm.toFixed(1)} km`)
          : null;
        const statusSuffix = b.isOpen === false ? ` · ${t('closedLabel', lang)}` : '';
        const tagPart = distLabel ? `${distLabel} · ${b.tagline}` : b.tagline;
        const description = `${tagPart}${statusSuffix}`.slice(0, 72);
        return { id: `restaurant_${b.id}`, title: b.name.slice(0, 24), description };
      }),
    }],
  });
}

// Returns the customer's saved name if one exists (and isn't the anonymous fallback), otherwise null.
async function getKnownName(phone, businessId) {
  try {
    const snap = await customersRef(businessId).doc(phone).get();
    const name = snap.data()?.name;
    return (name && name !== 'WhatsApp Customer') ? name : null;
  } catch {
    return null;
  }
}

// Sends the final confirmation message and sets state to 'confirming'.
// Call instead of transitioning to awaiting_name when a known name is available.
async function transitionToConfirming(from, session, lang, businessId, basket, name) {
  const subtotal = basket.reduce((s, i) => s + i.price * i.qty, 0);
  let displayTotal = subtotal;
  if (session.orderType === 'delivery') {
    const info = await getBusinessInfo(businessId);
    displayTotal = subtotal + (info.deliveryFee || 0);
  }
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

async function deleteStale(phone, session) {
  const ids = session.pendingDeleteIds ?? [];
  if (ids.length) await Promise.allSettled(ids.map(id => deleteMessage(id)));
}

// routing: { businessIds: string[], defaultBusinessId: string|null }
// message shape:
//   { type: 'text', text }
//   { type: 'list_reply', id, title }       — list menu or restaurant picker
//   { type: 'button_reply', id, title }
//   { type: 'cart_submitted', items: [{ productId, qty, price, currency }] } — catalog flow
async function handleMessage(routing, { from, contactName, type, text, id, items, latitude, longitude }) {
  if (!routing.businessIds.length) {
    console.warn(`[bot] no restaurants routed for this WhatsApp number — ignoring message from ${from}`);
    return;
  }

  let session = await getSession(from);
  const norm = (text ?? '').trim().toLowerCase();
  const isMulti = routing.businessIds.length > 1;

  await deleteStale(from, session);

  // Language override (text only)
  if (type === 'text') {
    const overrideLang = getOverride(norm);
    if (overrideLang) {
      await setSession(from, { ...session, language: overrideLang, pendingDeleteIds: [] });
      await sendText(from, t('langChanged', overrideLang));
      return;
    }
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
    const lang = session.language || (type === 'text' ? detectLanguage(text) : 'en');
    if (isMulti) {
      const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
      await setSession(from, { state: 'awaiting_location', language: lang, basket: [], businessId: null, pendingDeleteIds: locId ? [locId] : [] });
      return;
    }
    const bid = routing.defaultBusinessId || routing.businessIds[0];
    const bidInfo = await getBusinessInfo(bid);
    if (!isOrderingOpen(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna')) {
      const _w0 = getTodayOrderWindow(bidInfo.schedule, bidInfo.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', lang, bidInfo.name, _w0?.firstOrderTime ?? null, _w0?.lastOrderTime ?? null));
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: [] });
      return;
    }
    const menuId = await sendCatalog(from, lang, bid);
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid, pendingDeleteIds: menuId ? [menuId] : [] });
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

  // Switch restaurant command — available from any state (multi only)
  if (isMulti && type === 'text' && SWITCH_KEYWORDS.has(norm)) {
    await sendText(from, t('switchConfirmed', lang));
    if (session.lat != null && session.lng != null) {
      const businesses = sortByDistance(await getBusinessesInfo(routing.businessIds), session.lat, session.lng);
      const pickerId = await sendRestaurantPicker(from, businesses, lang);
      await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null, lat: session.lat, lng: session.lng, pendingDeleteIds: pickerId ? [pickerId] : [] });
    } else {
      const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
      await setSession(from, { state: 'awaiting_location', language: lang, basket: [], businessId: null, pendingDeleteIds: locId ? [locId] : [] });
    }
    return;
  }

  // ── State: awaiting_location ──────────────────────────────────────────────
  if (session.state === 'awaiting_location') {
    let businesses = await getBusinessesInfo(routing.businessIds);
    let lat = null, lng = null;
    if (type === 'location' && latitude != null && longitude != null) {
      lat = latitude;
      lng = longitude;
      businesses = sortByDistance(businesses, lat, lng);
    }
    const pickerId = await sendRestaurantPicker(from, businesses, lang);
    await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null, lat, lng, pendingDeleteIds: pickerId ? [pickerId] : [] });
    return;
  }

  // ── State: selecting_restaurant ───────────────────────────────────────────
  if (session.state === 'selecting_restaurant') {
    if (type === 'location' && latitude != null && longitude != null) {
      const businesses = sortByDistance(await getBusinessesInfo(routing.businessIds), latitude, longitude);
      const pickerId = await sendRestaurantPicker(from, businesses, lang);
      await setSession(from, { ...session, lat: latitude, lng: longitude, pendingDeleteIds: pickerId ? [pickerId] : [] });
      return;
    }
    if (type === 'list_reply' && id?.startsWith('restaurant_')) {
      const selectedBid = id.replace('restaurant_', '');
      if (!routing.businessIds.includes(selectedBid)) {
        let businesses = await getBusinessesInfo(routing.businessIds);
        if (session.lat != null && session.lng != null) {
          businesses = sortByDistance(businesses, session.lat, session.lng);
        }
        await sendRestaurantPicker(from, businesses, lang);
        return;
      }
      const selectedInfo = await getBusinessInfo(selectedBid);
      if (!isOrderingOpen(selectedInfo.schedule, selectedInfo.timezone || 'Europe/Vienna')) {
        const _w1 = getTodayOrderWindow(selectedInfo.schedule, selectedInfo.timezone || 'Europe/Vienna');
        await sendText(from, t('restaurantClosed', lang, selectedInfo.name, _w1?.firstOrderTime ?? null, _w1?.lastOrderTime ?? null));
        return;
      }
      const menuId = await sendCatalog(from, lang, selectedBid);
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: selectedBid, pendingDeleteIds: menuId ? [menuId] : [] });
      return;
    }
    // Any other input while picking: re-show the picker (sorted if location known)
    let businesses = await getBusinessesInfo(routing.businessIds);
    if (session.lat != null && session.lng != null) {
      businesses = sortByDistance(businesses, session.lat, session.lng);
    }
    await sendRestaurantPicker(from, businesses, lang);
    return;
  }

  // ── State: awaiting_restaurant_choice ────────────────────────────────────
  if (isMulti && session.state === 'awaiting_restaurant_choice') {
    if (type === 'button_reply') {
      if (id === 'btn_order_again') {
        const againInfo = await getBusinessInfo(businessId);
        if (!isOrderingOpen(againInfo.schedule, againInfo.timezone || 'Europe/Vienna')) {
          const _w2 = getTodayOrderWindow(againInfo.schedule, againInfo.timezone || 'Europe/Vienna');
          await sendText(from, t('restaurantClosed', lang, againInfo.name, _w2?.firstOrderTime ?? null, _w2?.lastOrderTime ?? null));
          return;
        }
        const menuId = await sendCatalog(from, lang, businessId);
        await setSession(from, { ...session, state: 'browsing', pendingDeleteIds: menuId ? [menuId] : [] });
        return;
      }
      if (id === 'btn_choose_restaurant') {
        if (session.lat != null && session.lng != null) {
          const businesses = sortByDistance(await getBusinessesInfo(routing.businessIds), session.lat, session.lng);
          const pickerId = await sendRestaurantPicker(from, businesses, lang);
          await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null, lat: session.lat, lng: session.lng, pendingDeleteIds: pickerId ? [pickerId] : [] });
        } else {
          const locId = await sendLocationRequest(from, t('locationRequestBody', lang));
          await setSession(from, { state: 'awaiting_location', language: lang, basket: [], businessId: null, pendingDeleteIds: locId ? [locId] : [] });
        }
        return;
      }
    }
    const info = await getBusinessInfo(businessId);
    await sendButtonMessage(from, {
      body: t('orderAgainPrompt', lang, info.name),
      buttons: [
        { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
        { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
      ],
    });
    return;
  }

  // ── State: selecting (list flow — waiting for qty) ────────────────────────
  if (session.state === 'selecting') {
    let qty = null;

    if (type === 'button_reply' && id?.startsWith('qty_')) {
      qty = parseInt(id.split('_')[1], 10);
    } else if (type === 'text' && /^\d+$/.test(norm)) {
      qty = Math.min(99, Math.max(1, parseInt(norm, 10)));
    }

    if (qty && session.pendingItem) {
      const { name, price } = session.pendingItem;
      const existing = basket.find(i => i.name === name);
      const newBasket = existing
        ? basket.map(i => i.name === name ? { ...i, qty: i.qty + qty } : i)
        : [...basket, { name, qty, price }];

      const totalItems = newBasket.reduce((s, i) => s + i.qty, 0);
      const totalPrice = newBasket.reduce((s, i) => s + i.price * i.qty, 0);

      // item-added buttons are kept visible — not tracked for deletion
      await sendButtonMessage(from, {
        body: t('itemAdded', lang, qty, name, totalItems, totalPrice.toFixed(2)),
        buttons: [
          { id: 'btn_add_more',    title: t('addMoreBtn', lang) },
          { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
          { id: 'btn_done',        title: t('doneBtn', lang) },
        ],
      });
      await setSession(from, { state: 'browsing', language: lang, basket: newBasket, businessId, pendingDeleteIds: [], ...(session.flow ? { flow: session.flow } : {}) });
      return;
    }

    if (session.pendingItem) {
      const { name, price } = session.pendingItem;
      await sendButtonMessage(from, {
        body: t('qtyBody', lang, name, price.toFixed(2)),
        buttons: [
          { id: 'qty_1', title: '1' },
          { id: 'qty_2', title: '2' },
          { id: 'qty_3', title: '3' },
        ],
      });
    }
    return;
  }

  // ── State: awaiting_special_requests ──────────────────────────────────────
  if (session.state === 'awaiting_special_requests') {
    const isSkip = type === 'button_reply' && id === 'btn_skip_requests';
    const notes = isSkip ? '' : (type === 'text' && norm.length > 0 ? text.trim() : null);

    if (notes !== null) {
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
      buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
    });
    return;
  }

  // ── State: awaiting_order_type ────────────────────────────────────────────
  if (session.state === 'awaiting_order_type') {
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
        const rows = await getDeliveryAddressRows(session, from, businessId, lang);
        if (rows) {
          const pickerId = await sendDeliveryAddressPicker(from, rows, lang);
          await setSession(from, { ...session, state: 'awaiting_delivery_address_choice', orderType: 'delivery', pendingDeleteIds: pickerId ? [pickerId] : [] });
        } else {
          const askId = await sendText(from, t('askDeliveryAddress', lang));
          await setSession(from, { ...session, state: 'awaiting_delivery_address', orderType: 'delivery', pendingDeleteIds: askId ? [askId] : [] });
        }
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
    return;
  }

  // ── State: awaiting_delivery_address_choice ───────────────────────────────
  if (session.state === 'awaiting_delivery_address_choice') {
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
    return;
  }

  // ── State: awaiting_delivery_address ──────────────────────────────────────
  if (session.state === 'awaiting_delivery_address') {
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
    return;
  }

  // ── State: awaiting_name ──────────────────────────────────────────────────
  if (session.state === 'awaiting_name') {
    if (type === 'text' && norm.length > 0) {
      const name = text.trim().slice(0, 60);
      await transitionToConfirming(from, session, lang, businessId, basket, name);
      return;
    }
    await sendText(from, t('confirmSummary', lang, buildBasketText(basket, lang), session.prepMins, session.pickupTime));
    return;
  }

  // ── State: confirming ─────────────────────────────────────────────────────
  if (session.state === 'confirming') {
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
      if (isMulti) {
        await setSession(from, { state: 'awaiting_restaurant_choice', language: lang, basket: [], businessId, pendingDeleteIds: [] });
        await sendButtonMessage(from, {
          body: t('orderConfirmedWithChoice', lang, shortId, info.name),
          buttons: [
            { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
            { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
          ],
        });
      } else {
        const itemLines = basket.map(i => `• ${i.qty}× ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [] });
        await sendText(from, t('orderReceipt', lang, shortId, info.name, itemLines, orderTotal.toFixed(2), session.pickupTime, session.customerName, session.deliveryAddress ?? null));
      }
      return;
    }

    if (isCancel) {
      if (isMulti) {
        const info = await getBusinessInfo(businessId);
        await setSession(from, { state: 'awaiting_restaurant_choice', language: lang, basket: [], businessId, pendingDeleteIds: [] });
        await sendButtonMessage(from, {
          body: t('orderCancelledWithChoice', lang, info.name),
          buttons: [
            { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
            { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
          ],
        });
      } else {
        const menuId = await sendCatalog(from, lang, businessId, t('orderCancelled', lang));
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: menuId ? [menuId] : [] });
      }
      return;
    }

    await sendText(from, t('yesNoOnly', lang));
    return;
  }

  // ── State: browsing ───────────────────────────────────────────────────────

  // Cart submitted from catalog UI
  if (type === 'cart_submitted') {
    if (!items || !items.length) {
      await sendCatalog(from, lang, businessId);
      return;
    }
    const [menu, info] = await Promise.all([getMenu(businessId), getBusinessInfo(businessId)]);
    if (!isOrderingOpen(info.schedule, info.timezone || 'Europe/Vienna')) {
      const _w3 = getTodayOrderWindow(info.schedule, info.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', lang, info.name, _w3?.firstOrderTime ?? null, _w3?.lastOrderTime ?? null));
      return;
    }
    const newBasket = items.map(item => {
      const menuItem = menu.find(m => m.id === item.productId);
      return { name: menuItem?.name ?? item.productId, qty: item.qty, price: item.price };
    });
    const prepMins = info.avgPrepTime || 30;
    const pickupTime = new Date(Date.now() + prepMins * 60000)
      .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });

    const reqId = await sendButtonMessage(from, {
      body: t('specialRequestsPrompt', lang),
      buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
    });
    await setSession(from, { state: 'awaiting_special_requests', language: lang, basket: newBasket, pickupTime, prepMins, businessId, pendingDeleteIds: reqId ? [reqId] : [] });
    return;
  }

  // Item selected from list menu (fallback flow)
  if (type === 'list_reply') {
    const itemId = id.replace('item_', '');
    const menu = await getMenu(businessId);
    const item = menu.find(i => i.id === itemId);
    if (!item) {
      await sendCatalog(from, lang, businessId);
      return;
    }
    const qtyId = await sendButtonMessage(from, {
      body: t('qtyBody', lang, item.name, item.price.toFixed(2)),
      buttons: [
        { id: 'qty_1', title: '1' },
        { id: 'qty_2', title: '2' },
        { id: 'qty_3', title: '3' },
      ],
    });
    await setSession(from, { ...session, state: 'selecting', flow: 'list', pendingItem: { name: item.name, price: item.price }, pendingDeleteIds: qtyId ? [qtyId] : [] });
    return;
  }

  // Action buttons (post-add or basket view)
  if (type === 'button_reply') {
    if (id === 'btn_add_more') {
      if (session.flow === 'list') {
        const menuId = await sendMenu(from, lang, businessId);
        await setSession(from, { ...session, pendingDeleteIds: menuId ? [menuId] : [] });
      } else {
        const menuId = await sendCatalog(from, lang, businessId);
        await setSession(from, { ...session, pendingDeleteIds: menuId ? [menuId] : [] });
      }
      return;
    }

    if (id === 'btn_view_basket') {
      if (!basket.length) {
        await sendCatalog(from, lang, businessId, t('basketEmpty', lang));
        return;
      }
      await sendButtonMessage(from, {
        body: buildBasketText(basket, lang),
        buttons: [
          { id: 'btn_add_more',     title: t('addMoreBtn', lang) },
          { id: 'btn_clear_basket', title: t('clearBasketBtn', lang) },
          { id: 'btn_confirm',      title: t('confirmBtn', lang) },
        ],
      });
      return;
    }

    if (id === 'btn_clear_basket') {
      const menuId = await sendCatalog(from, lang, businessId);
      await setSession(from, { ...session, basket: [], pendingDeleteIds: menuId ? [menuId] : [] });
      return;
    }

    if (id === 'btn_done' || id === 'btn_confirm') {
      if (!basket.length) {
        await sendCatalog(from, lang, businessId, t('basketEmpty', lang));
        return;
      }
      const info = await getBusinessInfo(businessId);
      if (!isOrderingOpen(info.schedule, info.timezone || 'Europe/Vienna')) {
        const _w4 = getTodayOrderWindow(info.schedule, info.timezone || 'Europe/Vienna');
        await sendText(from, t('restaurantClosed', lang, info.name, _w4?.firstOrderTime ?? null, _w4?.lastOrderTime ?? null));
        return;
      }
      const prepMins = info.avgPrepTime || 30;
      const pickupTime = new Date(Date.now() + prepMins * 60000)
        .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
      const reqId = await sendButtonMessage(from, {
        body: t('specialRequestsPrompt', lang),
        buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
      });
      await setSession(from, { ...session, state: 'awaiting_special_requests', pickupTime, prepMins, pendingDeleteIds: reqId ? [reqId] : [] });
      return;
    }

    if (id === 'btn_cancel_order') {
      if (isMulti) {
        const info = await getBusinessInfo(businessId);
        await setSession(from, { state: 'awaiting_restaurant_choice', language: lang, basket: [], businessId, pendingDeleteIds: [] });
        await sendButtonMessage(from, {
          body: t('orderCancelledWithChoice', lang, info.name),
          buttons: [
            { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
            { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
          ],
        });
      } else {
        const menuId = await sendCatalog(from, lang, businessId, t('orderCancelled', lang));
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: menuId ? [menuId] : [] });
      }
      return;
    }
  }

  // Text: basket keyword
  if (type === 'text' && BASKET_KEYWORDS.has(norm)) {
    if (!basket.length) {
      await sendCatalog(from, lang, businessId, t('basketEmpty', lang));
      return;
    }
    await sendButtonMessage(from, {
      body: buildBasketText(basket, lang),
      buttons: [
        { id: 'btn_add_more',     title: t('addMoreBtn', lang) },
        { id: 'btn_clear_basket', title: t('clearBasketBtn', lang) },
        { id: 'btn_confirm',      title: t('confirmBtn', lang) },
      ],
    });
    return;
  }

  // Default: show catalog (with list fallback)
  await sendCatalog(from, lang, businessId);
}

module.exports = { handleMessage };
