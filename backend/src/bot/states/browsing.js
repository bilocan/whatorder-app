const { setSession } = require('../sessionStore');
const { sendText, sendButtonMessage, sendImage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { buildBasketText, sendMenu, sendCatalog } = require('../botHelpers');
const { getMenu, getBusinessInfo, resolvePhotoUrl } = require('../menuService');
const { isOrderingOpen, getTodayOrderWindow } = require('../../lib/schedule');

const BASKET_KEYWORDS = new Set(['basket', 'sepet', 'warenkorb']);

async function handleSelecting({ from, session, lang, businessId, basket, type, id, norm }) {
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
    await setSession(from, { state: 'browsing', language: lang, basket: newBasket, businessId, lat: session.lat ?? null, lng: session.lng ?? null, pendingDeleteIds: [], ...(session.flow ? { flow: session.flow } : {}) });
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
}

async function handleBrowsing({ from, session, lang, businessId, basket, isMulti, type, id, items, norm }) {
  // Cart submitted from catalog UI
  if (type === 'cart_submitted') {
    if (!items || !items.length) {
      await sendCatalog(from, lang, businessId);
      return;
    }
    const [menu, info] = await Promise.all([getMenu(businessId), getBusinessInfo(businessId)]);
    if (!isOrderingOpen(info.schedule, info.timezone || 'Europe/Vienna')) {
      const _w = getTodayOrderWindow(info.schedule, info.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', lang, info.name, _w?.firstOrderTime ?? null, _w?.lastOrderTime ?? null));
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
    await setSession(from, { state: 'awaiting_special_requests', language: lang, basket: newBasket, pickupTime, prepMins, businessId, lat: session.lat ?? null, lng: session.lng ?? null, pendingDeleteIds: reqId ? [reqId] : [] });
    return;
  }

  // Flow completed — basket already written to session by /flow/exchange during ORDER_ITEM steps
  if (type === 'flow_completion') {
    const flowBasket = session.basket ?? [];
    if (!flowBasket.length) {
      await sendCatalog(from, lang, businessId);
      return;
    }
    const info = await getBusinessInfo(businessId);
    if (!isOrderingOpen(info.schedule, info.timezone || 'Europe/Vienna')) {
      const _w = getTodayOrderWindow(info.schedule, info.timezone || 'Europe/Vienna');
      await sendText(from, t('restaurantClosed', lang, info.name, _w?.firstOrderTime ?? null, _w?.lastOrderTime ?? null));
      return;
    }
    const prepMins = info.avgPrepTime || 30;
    const pickupTime = new Date(Date.now() + prepMins * 60000)
      .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    const reqId = await sendButtonMessage(from, {
      body: t('specialRequestsPrompt', lang),
      buttons: [
        { id: 'btn_skip_requests', title: t('skipBtn', lang) },
        { id: 'btn_edit_cart',     title: t('editCartBtn', lang) },
      ],
    });
    await setSession(from, { ...session, state: 'awaiting_special_requests', basket: flowBasket, pickupTime, prepMins, businessId, pendingDeleteIds: reqId ? [reqId] : [] });
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
    const photoUrl = resolvePhotoUrl(item.photoUrl);
    if (photoUrl) {
      try { await sendImage(from, { url: photoUrl }); } catch { /* non-fatal */ }
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
        const _w = getTodayOrderWindow(info.schedule, info.timezone || 'Europe/Vienna');
        await sendText(from, t('restaurantClosed', lang, info.name, _w?.firstOrderTime ?? null, _w?.lastOrderTime ?? null));
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
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [] });
        await sendText(from, t('checkoutCancelled', lang));
      } else {
        const menuId = await sendCatalog(from, lang, businessId, t('checkoutCancelled', lang));
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

module.exports = { handleSelecting, handleBrowsing };
