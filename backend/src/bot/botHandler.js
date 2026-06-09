const { getSession, setSession } = require('./sessionStore');
const { getMenu, getBusinessInfo } = require('./menuService');
const { createOrder } = require('./orderService');
const { sendText, sendListMessage, sendButtonMessage, sendCatalogMessage } = require('../lib/whatsapp');
const { detectLanguage, getOverride } = require('./languageDetector');
const { t, tCategory } = require('./templates');

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
    return;
  }
  await sendListMessage(to, {
    header: t('menuListHeader', lang, info.name),
    body: bodyOverride ?? t('menuListBody', lang),
    footer: t('menuListFooter', lang),
    buttonLabel: t('viewMenuBtn', lang),
    sections: buildMenuSections(menu, lang),
  });
}

// Tries catalog message; falls back to list menu if catalog is unavailable or rejected.
async function sendCatalog(to, lang, businessId, bodyOverride) {
  const [info, menu] = await Promise.all([getBusinessInfo(businessId), getMenu(businessId)]);
  if (!info.catalogId || !menu.length) {
    await sendMenu(to, lang, businessId, bodyOverride);
    return;
  }
  try {
    await sendCatalogMessage(to, info.catalogId, bodyOverride ?? t('catalogBody', lang, info.name), menu[0].id);
  } catch {
    await sendMenu(to, lang, businessId, bodyOverride);
  }
}

async function getBusinessesInfo(businessIds) {
  return Promise.all(businessIds.map(async bid => {
    const info = await getBusinessInfo(bid);
    return { id: bid, name: info.name, tagline: info.tagline || info.cuisine || '' };
  }));
}

async function sendRestaurantPicker(to, businesses, lang) {
  await sendListMessage(to, {
    header: 'WhatOrder',
    body: t('restaurantPickerBody', lang),
    footer: t('restaurantPickerFooter', lang),
    buttonLabel: t('restaurantPickerButton', lang),
    sections: [{
      title: 'Restaurants',
      rows: businesses.map(b => ({
        id: `restaurant_${b.id}`,
        title: b.name.slice(0, 24),
        description: b.tagline.slice(0, 72),
      })),
    }],
  });
}

// routing: { businessIds: string[], defaultBusinessId: string|null }
// message shape:
//   { type: 'text', text }
//   { type: 'list_reply', id, title }       — list menu or restaurant picker
//   { type: 'button_reply', id, title }
//   { type: 'cart_submitted', items: [{ productId, qty, price, currency }] } — catalog flow
async function handleMessage(routing, { from, contactName, type, text, id, items }) {
  const session = await getSession(from);
  const norm = (text ?? '').trim().toLowerCase();
  const isMulti = routing.businessIds.length > 1;

  // Language override (text only)
  if (type === 'text') {
    const overrideLang = getOverride(norm);
    if (overrideLang) {
      await setSession(from, { ...session, language: overrideLang });
      await sendText(from, t('langChanged', overrideLang));
      return;
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
  if (!session.language || (isMulti && !session.businessId && session.state !== 'selecting_restaurant') || sessionExpiredForPicker) {
    const lang = session.language || (type === 'text' ? detectLanguage(text) : 'tr');
    if (isMulti) {
      const businesses = await getBusinessesInfo(routing.businessIds);
      await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null });
      await sendRestaurantPicker(from, businesses, lang);
      return;
    }
    const bid = routing.defaultBusinessId || routing.businessIds[0];
    await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: bid });
    await sendCatalog(from, lang, bid);
    return;
  }

  const lang = session.language;
  const businessId = session.businessId || routing.defaultBusinessId || routing.businessIds[0];
  const basket = session.basket ?? [];

  // Switch restaurant command — available from any state (multi only)
  if (isMulti && type === 'text' && SWITCH_KEYWORDS.has(norm)) {
    const businesses = await getBusinessesInfo(routing.businessIds);
    await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null });
    await sendText(from, t('switchConfirmed', lang));
    await sendRestaurantPicker(from, businesses, lang);
    return;
  }

  // ── State: selecting_restaurant ───────────────────────────────────────────
  if (session.state === 'selecting_restaurant') {
    if (type === 'list_reply' && id?.startsWith('restaurant_')) {
      const selectedBid = id.replace('restaurant_', '');
      if (!routing.businessIds.includes(selectedBid)) {
        const businesses = await getBusinessesInfo(routing.businessIds);
        await sendRestaurantPicker(from, businesses, lang);
        return;
      }
      await setSession(from, { state: 'browsing', language: lang, basket: [], businessId: selectedBid });
      await sendCatalog(from, lang, selectedBid);
      return;
    }
    // Any other input while picking: re-show the picker
    const businesses = await getBusinessesInfo(routing.businessIds);
    await sendRestaurantPicker(from, businesses, lang);
    return;
  }

  // ── State: awaiting_restaurant_choice ────────────────────────────────────
  if (isMulti && session.state === 'awaiting_restaurant_choice') {
    if (type === 'button_reply') {
      if (id === 'btn_order_again') {
        await setSession(from, { ...session, state: 'browsing' });
        await sendCatalog(from, lang, businessId);
        return;
      }
      if (id === 'btn_choose_restaurant') {
        const businesses = await getBusinessesInfo(routing.businessIds);
        await setSession(from, { state: 'selecting_restaurant', language: lang, basket: [], businessId: null });
        await sendRestaurantPicker(from, businesses, lang);
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

      await setSession(from, { state: 'browsing', language: lang, basket: newBasket, businessId });
      await sendButtonMessage(from, {
        body: t('itemAdded', lang, qty, name, totalItems, totalPrice.toFixed(2)),
        buttons: [
          { id: 'btn_add_more',    title: t('addMoreBtn', lang) },
          { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
          { id: 'btn_done',        title: t('doneBtn', lang) },
        ],
      });
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
      await setSession(from, { ...session, state: 'awaiting_name', specialRequests: notes });
      await sendText(from, t('askName', lang));
      return;
    }
    await sendButtonMessage(from, {
      body: t('specialRequestsPrompt', lang),
      buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
    });
    return;
  }

  // ── State: awaiting_name ──────────────────────────────────────────────────
  if (session.state === 'awaiting_name') {
    if (type === 'text' && norm.length > 0) {
      const name = text.trim().slice(0, 60);
      const total = basket.reduce((s, i) => s + i.price * i.qty, 0);
      await setSession(from, { ...session, state: 'confirming', customerName: name });
      await sendButtonMessage(from, {
        body: t('finalConfirmBody', lang, name, total.toFixed(2), session.pickupTime),
        buttons: [
          { id: 'btn_place_order',  title: t('confirmOrderBtn', lang) },
          { id: 'btn_cancel_order', title: t('cancelOrderBtn', lang) },
        ],
      });
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
      const total = basket.reduce((s, i) => s + i.price * i.qty, 0);
      const orderId = await createOrder(businessId, {
        customerPhone: from,
        customerName: session.customerName || contactName || null,
        items: basket,
        total,
        language: lang,
        pickupTime: session.pickupTime || null,
        notes: session.specialRequests || null,
      });
      const shortId = orderId.slice(-6).toUpperCase();
      if (isMulti) {
        const info = await getBusinessInfo(businessId);
        await setSession(from, { state: 'awaiting_restaurant_choice', language: lang, basket: [], businessId });
        await sendButtonMessage(from, {
          body: t('orderConfirmedWithChoice', lang, shortId, info.name),
          buttons: [
            { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
            { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
          ],
        });
      } else {
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId });
        await sendText(from, t('orderConfirmed', lang, shortId));
      }
      return;
    }

    if (isCancel) {
      if (isMulti) {
        const info = await getBusinessInfo(businessId);
        await setSession(from, { state: 'awaiting_restaurant_choice', language: lang, basket: [], businessId });
        await sendButtonMessage(from, {
          body: t('orderCancelledWithChoice', lang, info.name),
          buttons: [
            { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
            { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
          ],
        });
      } else {
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId });
        await sendCatalog(from, lang, businessId, t('orderCancelled', lang));
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
    const menu = await getMenu(businessId);
    const newBasket = items.map(item => {
      const menuItem = menu.find(m => m.id === item.productId);
      return { name: menuItem?.name ?? item.productId, qty: item.qty, price: item.price };
    });
    const info = await getBusinessInfo(businessId);
    const prepMins = info.avgPrepTime || 30;
    const pickupTime = new Date(Date.now() + prepMins * 60000)
      .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });

    await setSession(from, { state: 'awaiting_special_requests', language: lang, basket: newBasket, pickupTime, prepMins, businessId });
    await sendButtonMessage(from, {
      body: t('specialRequestsPrompt', lang),
      buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
    });
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
    await setSession(from, { ...session, state: 'selecting', pendingItem: { name: item.name, price: item.price } });
    await sendButtonMessage(from, {
      body: t('qtyBody', lang, item.name, item.price.toFixed(2)),
      buttons: [
        { id: 'qty_1', title: '1' },
        { id: 'qty_2', title: '2' },
        { id: 'qty_3', title: '3' },
      ],
    });
    return;
  }

  // Action buttons (post-add or basket view)
  if (type === 'button_reply') {
    if (id === 'btn_add_more') {
      await sendCatalog(from, lang, businessId);
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
      await setSession(from, { ...session, basket: [] });
      await sendCatalog(from, lang, businessId);
      return;
    }

    if (id === 'btn_done' || id === 'btn_confirm') {
      if (!basket.length) {
        await sendCatalog(from, lang, businessId, t('basketEmpty', lang));
        return;
      }
      const info = await getBusinessInfo(businessId);
      const prepMins = info.avgPrepTime || 30;
      const pickupTime = new Date(Date.now() + prepMins * 60000)
        .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
      await setSession(from, { ...session, state: 'awaiting_special_requests', pickupTime, prepMins });
      await sendButtonMessage(from, {
        body: t('specialRequestsPrompt', lang),
        buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
      });
      return;
    }

    if (id === 'btn_cancel_order') {
      if (isMulti) {
        const info = await getBusinessInfo(businessId);
        await setSession(from, { state: 'awaiting_restaurant_choice', language: lang, basket: [], businessId });
        await sendButtonMessage(from, {
          body: t('orderCancelledWithChoice', lang, info.name),
          buttons: [
            { id: 'btn_order_again',       title: t('orderAgainBtn', lang) },
            { id: 'btn_choose_restaurant', title: t('chooseRestaurantBtn', lang) },
          ],
        });
      } else {
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId });
        await sendCatalog(from, lang, businessId, t('orderCancelled', lang));
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
