const { patchSession, getSession } = require('./sessionStore');
const { sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildPostAddBody, postAddBasketButtons, sendCatalog } = require('./botHelpers');
const { getMenu } = require('./menuService');
const { getLastOrderForCustomer } = require('./orderService');
const { matchMenuItem } = require('./menuMatch');
const { tryTextIntentOrder } = require('./intentOrder');
const { isMenuRequest, sendOrderEntryPrompt } = require('./orderEntry');
const { isFreshStartCommand } = require('./intentParser');
const {
  tryMenuSearch,
  isShortLookupText,
  isSearchKeyword,
  sendSearchPrompt,
} = require('./menuSearch');

function buildReorderBasket(orderItems, menu) {
  const matched = [];
  const unmatched = [];

  for (const line of orderItems) {
    const qty = Math.min(99, Math.max(1, line.qty ?? 1));
    const baseName = (line.name ?? '').split(' — ')[0].trim();
    const item = matchMenuItem(line.name, menu) || matchMenuItem(baseName, menu);
    if (item && item.available !== false) {
      matched.push({ name: item.name, qty, price: Number(item.price) });
    } else if (line.name) {
      unmatched.push(line.name);
    }
  }

  return { matched, unmatched };
}

function buildReorderPromptBody(matched, unmatched, lang, restaurantName) {
  const lines = matched.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`);
  const total = matched.reduce((s, i) => s + i.price * i.qty, 0);
  let body = t('reorderPromptHeader', lang, restaurantName) + '\n\n' + lines.join('\n') + '\n\n' + t('orderTotal', lang, total.toFixed(2));
  if (unmatched.length) {
    body += '\n\n' + t('reorderUnmatched', lang, unmatched.join(', '));
  }
  body += '\n\n' + t('reorderConfirmPrompt', lang);
  return body;
}

async function tryOfferReorder({ from, session, lang, businessId, basket, businessName }) {
  const lastOrder = await getLastOrderForCustomer(businessId, from);
  if (!lastOrder) return false;

  const menu = await getMenu(businessId);
  const { matched, unmatched } = buildReorderBasket(lastOrder.items, menu);
  if (!matched.length) return false;

  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingReorderItems: matched,
    pendingReorderUnmatched: unmatched.length ? unmatched : undefined,
    pendingAmendOrderId: undefined,
    pendingAmendBusinessId: undefined,
    pendingAmendPlacedAt: undefined,
    specialRequests: undefined,
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: buildReorderPromptBody(matched, unmatched, lang, businessName),
    buttons: [
      { id: 'btn_reorder_confirm', title: t('reorderConfirmBtn', lang) },
      { id: 'btn_reorder_browse', title: t('reorderBrowseBtn', lang) },
    ],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
  return true;
}

async function handleReorderButtons({ from, session, lang, businessId, basket, id }) {
  if (id === 'btn_reorder_confirm') {
    const live = await getSession(from);
    const pending = live.pendingReorderItems ?? [];
    if (!pending.length) {
      await sendCatalog(from, lang, businessId);
      return true;
    }
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket: pending,
      pendingReorderItems: undefined,
      pendingReorderUnmatched: undefined,
      pendingDeleteIds: [],
    }, live);
    await sendButtonMessage(from, {
      body: buildPostAddBody(lang, pending, { reorder: true }),
      buttons: postAddBasketButtons(lang),
    });
    return true;
  }

  if (id === 'btn_reorder_browse') {
    const { menuId, textMenuIndex, textMenuCategory } = await sendCatalog(from, lang, businessId);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket,
      pendingReorderItems: undefined,
      pendingReorderUnmatched: undefined,
      menuId,
      textMenuIndex,
      textMenuCategory,
    }, session);
    return true;
  }

  return false;
}

// Layer 0–1 entry: menu keyword → catalog; intent → disambiguate/confirm; reorder → offer; else order entry prompt.
async function startRestaurantBrowsing({ from, session, lang, businessId, type, text, norm, businessName }) {
  // Any fresh browse clears the post-order amend context so subsequent food text is treated as a new order.
  if (session.pendingAmendOrderId) {
    await patchSession(from, {
      pendingAmendOrderId: undefined,
      pendingAmendBusinessId: undefined,
      pendingAmendPlacedAt: undefined,
    }, session);
  }
  const freshSession = {
    ...session,
    state: 'browsing',
    language: lang,
    basket: [],
    businessId,
    pendingDeleteIds: [],
  };
  const greetingPrefix = businessName ? t('greeting', lang, businessName) + '\n\n' : '';

  if (type === 'text' && isMenuRequest(norm)) {
    const { menuId, textMenuIndex, textMenuCategory } = await sendCatalog(from, lang, businessId);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket: [],
      textMenuIndex,
      textMenuCategory,
      menuId,
      specialRequests: undefined,
    });
    return;
  }

  if (type === 'text' && isSearchKeyword(norm)) {
    await sendSearchPrompt({ from, session: freshSession, lang, businessId, basket: [] });
    return;
  }

  if (type === 'text' && isFreshStartCommand(norm)) {
    if (await tryOfferReorder({ from, session: freshSession, lang, businessId, basket: [], businessName })) return;
    await sendOrderEntryPrompt({
      from, session: freshSession, lang, businessId, basket: [], fresh: true,
      ...(businessName ? { bodyOverride: greetingPrefix + t('orderEntryBody', lang) } : {}),
    });
    return;
  }

  if (type === 'text' && text?.trim()) {
    const handled = await tryTextIntentOrder({
      from, session: freshSession, lang, businessId, basket: [], text, norm,
    });
    if (handled === true) return;
    if (handled === 'llm_failed') {
      await sendOrderEntryPrompt({
        from, session: freshSession, lang, businessId, basket: [], fresh: true,
        bodyOverride: greetingPrefix + t('intentParseFailed', lang),
      });
      return;
    }
    if (isShortLookupText(text, norm)) {
      if (await tryMenuSearch({
        from, session: freshSession, lang, businessId, basket: [], text,
      })) return;
    }
  }

  if (await tryOfferReorder({ from, session: freshSession, lang, businessId, basket: [], businessName })) return;

  await sendOrderEntryPrompt({
    from, session: freshSession, lang, businessId, basket: [], fresh: true,
    ...(businessName ? { bodyOverride: greetingPrefix + t('orderEntryBody', lang) } : {}),
  });
}

module.exports = {
  buildReorderBasket,
  buildReorderPromptBody,
  tryOfferReorder,
  handleReorderButtons,
  startRestaurantBrowsing,
};
