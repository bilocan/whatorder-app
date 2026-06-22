const { patchSession, getSession } = require('./sessionStore');
const { sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildBasketText, sendCatalog } = require('./botHelpers');
const { getMenu } = require('./menuService');
const { getLastOrderForCustomer } = require('./orderService');
const { matchMenuItem } = require('./menuMatch');
const { tryTextIntentOrder } = require('./intentOrder');
const { isMenuRequest, sendOrderEntryPrompt } = require('./orderEntry');
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

function buildReorderPromptBody(matched, unmatched, lang) {
  const lines = matched.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`);
  const total = matched.reduce((s, i) => s + i.price * i.qty, 0);
  let body = t('reorderPromptHeader', lang) + '\n\n' + lines.join('\n') + '\n\n' + t('orderTotal', lang, total.toFixed(2));
  if (unmatched.length) {
    body += '\n\n' + t('reorderUnmatched', lang, unmatched.join(', '));
  }
  body += '\n\n' + t('reorderConfirmPrompt', lang);
  return body;
}

async function tryOfferReorder({ from, session, lang, businessId, basket }) {
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
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: buildReorderPromptBody(matched, unmatched, lang),
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
      body: buildBasketText(pending, lang),
      buttons: [
        { id: 'btn_add_more', title: t('addMoreBtn', lang) },
        { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
        { id: 'btn_confirm', title: t('confirmBtn', lang) },
      ],
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
async function startRestaurantBrowsing({ from, session, lang, businessId, type, text, norm }) {
  const freshSession = {
    ...session,
    state: 'browsing',
    language: lang,
    basket: [],
    businessId,
    pendingDeleteIds: [],
  };

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
    });
    return;
  }

  if (type === 'text' && isSearchKeyword(norm)) {
    await sendSearchPrompt({ from, session: freshSession, lang, businessId, basket: [] });
    return;
  }

  if (type === 'text' && text?.trim()) {
    const handled = await tryTextIntentOrder({
      from, session: freshSession, lang, businessId, basket: [], text, norm,
    });
    if (handled === true) return;
    if (handled === 'llm_failed') {
      await sendOrderEntryPrompt({
        from, session: freshSession, lang, businessId, basket: [],
        bodyOverride: t('intentParseFailed', lang),
      });
      return;
    }
    if (isShortLookupText(text, norm)) {
      if (await tryMenuSearch({
        from, session: freshSession, lang, businessId, basket: [], text,
      })) return;
    }
  }

  if (await tryOfferReorder({ from, session: freshSession, lang, businessId, basket: [] })) return;

  await sendOrderEntryPrompt({ from, session: freshSession, lang, businessId, basket: [] });
}

module.exports = {
  buildReorderBasket,
  buildReorderPromptBody,
  tryOfferReorder,
  handleReorderButtons,
  startRestaurantBrowsing,
};
