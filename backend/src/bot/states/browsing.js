const { setSession, patchSession } = require('../sessionStore');
const { sendText, sendButtonMessage, sendImage } = require('../../lib/whatsapp');
const { t } = require('../templates');
const { buildBasketText, sendMenu, sendMenuPage, sendCatalog, groupMenuByCategory, decodeCategory } = require('../botHelpers');
const { getMenu, getBusinessInfo, resolvePhotoUrl } = require('../menuService');
const { isOrderingOpen, getTodayOrderWindow } = require('../../lib/schedule');
const { tryTextIntentOrder, handleIntentButtons, isIntentConfirmText } = require('../intentOrder');
const { tryProposalEdit, parseProposalEdit } = require('../proposalEdit');
const { handleReorderButtons, tryOfferReorder } = require('../reorder');
const { isMenuRequest, sendOrderEntryPrompt } = require('../orderEntry');
const { isGreetingOnly, looksLikeOrderText } = require('../intentParser');
const { tryNumberSelectionOrder } = require('../textMenuOrder');
const { publishTextMenu, buildNumberedMenuChunks, sendPreparedTextMenu } = require('../textMenu');
const { resumeDeliveryCheckout, showDeliveryBasketGate, proceedFromConfirmedBasket } = require('./checkout');
const { sendPopularBoard } = require('../popularBoard');
const {
  sendSearchPrompt,
  handleSearchModeText,
  tryMenuSearch,
  isShortLookupText,
  isSearchKeyword,
} = require('../menuSearch');

const INTENT_PROPOSAL_CLEAR = {
  pendingIntentItems: undefined,
  unmatchedIntentItems: undefined,
  disambiguation: undefined,
};

function isFullOrderReplace(text, norm) {
  const edit = parseProposalEdit(text, norm);
  return edit?.type === 'replace';
}

function isShortProposalEdit(text, norm) {
  const edit = parseProposalEdit(text, norm);
  if (!edit) return false;
  return edit.type !== 'replace';
}

async function openCatalog(from, session, lang, businessId, bodyOverride, sessionOverrides = {}) {
  const { menuId, textMenuIndex, textMenuCategory } = await sendCatalog(from, lang, businessId, bodyOverride);
  await patchSession(from, {
    menuId,
    textMenuIndex,
    textMenuCategory,
    ...INTENT_PROPOSAL_CLEAR,
    ...sessionOverrides,
  }, session);
}

async function openCategoryMenu(from, session, lang, businessId, category) {
  const menu = await getMenu(businessId);
  const multiCategory = Object.keys(groupMenuByCategory(menu)).length > 1;
  const categoryItems = menu.filter(i => (i.category || 'other') === category);
  const { messages, indexed: textMenuIndex } = buildNumberedMenuChunks(categoryItems, lang, category);

  // Persist index before any outbound messages so a fast "1" reply still resolves.
  await patchSession(from, { menuId: null, textMenuIndex, textMenuCategory: category }, session);

  const menuId = await sendMenuPage(from, lang, businessId, null, menu, { category, page: 0, multiCategory });
  await sendPreparedTextMenu(from, messages);
  // menuId only — never pass stale textMenuIndex/null here (race with confirm flow).
  await patchSession(from, { menuId }, session);
}

// Gated on minimumOrderValue: order type is 'delivery' but no address has been collected
// yet, meaning the customer was redirected back here by the delivery minimum gate.
function isGatedOnDeliveryMinimum(session) {
  return session.orderType === 'delivery' && !session.deliveryAddress;
}

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

    const newSession = { ...session, state: 'browsing', language: lang, basket: newBasket, pendingDeleteIds: [] };

    // Gated on the delivery minimum: show the gate/basket directly (Confirm only once met)
    // instead of the generic item-added screen, which would always offer "Done".
    if (isGatedOnDeliveryMinimum(session)) {
      await showDeliveryBasketGate({ from, session: newSession, lang, basket: newBasket, businessId });
      return;
    }

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
    await setSession(from, newSession);
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

async function handleBrowsing({ from, session, lang, businessId, basket, isMulti, type, id, items, norm, text }) {
  // Cart submitted from catalog UI
  if (type === 'cart_submitted') {
    if (!items || !items.length) {
      await openCatalog(from, session, lang, businessId);
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

    if (isGatedOnDeliveryMinimum(session)) {
      await resumeDeliveryCheckout({ from, session: { ...session, basket: newBasket }, lang, businessId, basket: newBasket });
      return;
    }

    const prepMins = info.avgPrepTime || 30;
    const pickupTime = new Date(Date.now() + prepMins * 60000)
      .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });
    const newSession = { ...session, state: 'browsing', language: lang, basket: newBasket, pickupTime, prepMins, businessId, lat: session.lat ?? null, lng: session.lng ?? null, pendingDeleteIds: [] };
    await proceedFromConfirmedBasket({ from, session: newSession, lang, businessId, basket: newBasket });
    return;
  }

  // Flow completed — basket already written to session by /flow/exchange during ORDER_ITEM steps
  if (type === 'flow_completion') {
    const flowBasket = session.basket ?? [];
    if (!flowBasket.length) {
      await openCatalog(from, session, lang, businessId);
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
    const newSession = { ...session, state: 'browsing', basket: flowBasket, pickupTime, prepMins, businessId, pendingDeleteIds: [] };
    await proceedFromConfirmedBasket({ from, session: newSession, lang, businessId, basket: flowBasket });
    return;
  }

  // Item selected from list menu (fallback flow)
  if (type === 'list_reply') {
    if (id === 'nav_cats') {
      const { menuId, textMenuIndex, textMenuCategory } = await sendMenu(from, lang, businessId);
      await patchSession(from, { menuId, textMenuIndex, textMenuCategory }, session);
      return;
    }

    const navMatch = id.match(/^navp_([0-9a-f]+)_(\d+)$/);
    if (navMatch) {
      const category = decodeCategory(navMatch[1]);
      const page = parseInt(navMatch[2], 10);
      const menu = await getMenu(businessId);
      const multiCategory = Object.keys(groupMenuByCategory(menu)).length > 1;
      const menuId = await sendMenuPage(from, lang, businessId, null, menu, { category, page, multiCategory });
      await patchSession(from, { menuId }, session);
      return;
    }

    if (id.startsWith('cat_')) {
      const category = decodeCategory(id.slice(4));
      await openCategoryMenu(from, session, lang, businessId, category);
      return;
    }

    const itemId = id.replace('item_', '');
    const menu = await getMenu(businessId);
    const item = menu.find(i => i.id === itemId);
    if (!item) {
      await openCatalog(from, session, lang, businessId);
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
    if (await handleReorderButtons({ from, session, lang, businessId, basket, id })) return;
    if (await handleIntentButtons({ from, session, lang, businessId, basket, id })) return;

    if (id === 'btn_view_full_menu') {
      await openCatalog(from, session, lang, businessId);
      return;
    }

    if (id === 'btn_popular') {
      await sendPopularBoard({ from, session, lang, businessId, basket });
      return;
    }

    if (id === 'btn_search' || id === 'btn_search_cancel') {
      if (id === 'btn_search_cancel') {
        await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
        return;
      }
      await sendSearchPrompt({ from, session, lang, businessId, basket });
      return;
    }

    if (id === 'btn_add_more') {
      if (session.flow === 'list') {
        const { menuId, textMenuIndex, textMenuCategory } = await sendMenu(from, lang, businessId);
        await patchSession(from, { menuId, textMenuIndex, textMenuCategory }, session);
      } else {
        await openCatalog(from, session, lang, businessId);
      }
      return;
    }

    if (id === 'btn_view_basket') {
      if (!basket.length) {
        await openCatalog(from, session, lang, businessId, t('basketEmpty', lang));
        return;
      }
      if (isGatedOnDeliveryMinimum(session)) {
        await showDeliveryBasketGate({ from, session, lang, basket, businessId });
        return;
      }
      await sendButtonMessage(from, {
        body: buildBasketText(basket, lang, session.specialRequests),
        buttons: [
          { id: 'btn_add_more',     title: t('addMoreBtn', lang) },
          { id: 'btn_clear_basket', title: t('clearBasketBtn', lang) },
          { id: 'btn_confirm',      title: t('confirmBtn', lang) },
        ],
      });
      return;
    }

    if (id === 'btn_clear_basket') {
      // Full reset, not just the basket: orderType/deliveryAddress/specialRequests must not
      // survive, otherwise the customer stays "delivery-gated" after re-adding items even
      // though they haven't been asked pickup-or-delivery again yet.
      await openCatalog(from, session, lang, businessId, undefined, {
        basket: [],
        flow: undefined,
        orderType: undefined,
        deliveryAddress: undefined,
        specialRequests: undefined,
      });
      return;
    }
    if (id === 'btn_done' || id === 'btn_confirm') {
      if (!basket.length) {
        await openCatalog(from, session, lang, businessId, t('basketEmpty', lang));
        return;
      }
      if (isGatedOnDeliveryMinimum(session)) {
        await resumeDeliveryCheckout({ from, session, lang, businessId, basket });
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
      const newSession = { ...session, pickupTime, prepMins, pendingDeleteIds: [] };
      await proceedFromConfirmedBasket({ from, session: newSession, lang, businessId, basket });
      return;
    }

    if (id === 'btn_cancel_order') {
      if (isMulti) {
        await setSession(from, { state: 'browsing', language: lang, basket: [], businessId, pendingDeleteIds: [] });
        await sendText(from, t('checkoutCancelled', lang));
      } else {
        await openCatalog(from, session, lang, businessId, t('checkoutCancelled', lang), {
          basket: [],
          flow: undefined,
          orderType: undefined,
          deliveryAddress: undefined,
          specialRequests: undefined,
        });
      }      return;
    }
  }

  // Text: full menu keyword (Layer 5 escape hatch)
  if (type === 'text' && isMenuRequest(norm)) {
    await openCatalog(from, session, lang, businessId);
    return;
  }

  // Text: basket keyword (before intent — "basket" is also ≥3 chars)
  if (type === 'text' && BASKET_KEYWORDS.has(norm)) {
    if (!basket.length) {
      await sendOrderEntryPrompt({ from, session, lang, businessId, bodyOverride: t('basketEmpty', lang) });
      return;
    }
    if (isGatedOnDeliveryMinimum(session)) {
      await showDeliveryBasketGate({ from, session, lang, basket, businessId });
      return;
    }
    await sendButtonMessage(from, {
      body: buildBasketText(basket, lang, session.specialRequests),
      buttons: [
        { id: 'btn_add_more',     title: t('addMoreBtn', lang) },
        { id: 'btn_clear_basket', title: t('clearBasketBtn', lang) },
        { id: 'btn_confirm',      title: t('confirmBtn', lang) },
      ],
    });
    return;
  }

  // Text: search keyword → search prompt (Layer 2)
  if (type === 'text' && isSearchKeyword(norm)) {
    await sendSearchPrompt({ from, session, lang, businessId, basket });
    return;
  }

  // Text: active search mode
  if (type === 'text' && text?.trim() && session.menuSearchActive) {
    if (await handleSearchModeText({ from, session, lang, businessId, basket, text, norm })) return;
  }

  // Text: numbered selection — skip default catalog resend for digit-only replies
  if (type === 'text' && text?.trim() && /^[\d\s,;xX×*.+-]+$/.test(text.trim()) && /\d/.test(text)) {
    if (await tryNumberSelectionOrder({ from, session, lang, businessId, basket, text })) return;
    await sendText(from, t('textMenuPickCategory', lang));
    return;
  }

  // Text: short edits / confirm while a proposal is pending (ohne ayran, cola, Hinzufügen)
  if (type === 'text' && text?.trim() && session.pendingIntentItems?.length) {
    if (isIntentConfirmText(text, lang)) {
      if (await handleIntentButtons({
        from, session, lang, businessId, basket, id: 'btn_intent_confirm',
      })) return;
    }
    if (isShortProposalEdit(text, norm) && !isFullOrderReplace(text, norm)) {
      if (await tryProposalEdit({ from, session, lang, businessId, basket, text, norm })) return;
    }
  }

  // Text: natural-language order (clears stale proposals before AI/rules parse)
  if (type === 'text' && text?.trim() && looksLikeOrderText(text, norm)) {
    if (session.pendingIntentItems?.length && isFullOrderReplace(text, norm)) {
      await patchSession(from, INTENT_PROPOSAL_CLEAR, session);
      session = { ...session, ...INTENT_PROPOSAL_CLEAR };
    }
    const intentHandled = await tryTextIntentOrder({ from, session, lang, businessId, basket, text, norm });
    if (intentHandled === true) return;
    if (intentHandled === 'llm_failed') {
      await sendOrderEntryPrompt({
        from, session, lang, businessId, basket,
        bodyOverride: t('intentParseFailed', lang),
      });
      return;
    }
    if (isShortLookupText(text, norm)) {
      if (await tryMenuSearch({ from, session, lang, businessId, basket, text })) return;
    }
    if (!session.pendingIntentItems?.length) {
      await sendOrderEntryPrompt({
        from, session, lang, businessId, basket,
        bodyOverride: t('intentNoMatch', lang, text.trim()),
      });
      return;
    }
  }

  // Text: greeting with empty basket — offer reorder (Layer 0) before order entry
  if (type === 'text' && text?.trim() && isGreetingOnly(norm) && !basket.length) {
    if (await tryOfferReorder({ from, session, lang, businessId, basket })) return;
    await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
    return;
  }

  // Default: order entry prompt (Layer 1) when basket empty, else re-show menu
  if (!basket.length) {
    await sendOrderEntryPrompt({ from, session, lang, businessId, basket });
  } else {
    await openCatalog(from, session, lang, businessId);
  }
}

module.exports = { handleSelecting, handleBrowsing };
