const { patchSession, getSession } = require('./sessionStore');
const { sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildBasketText, sendCatalog } = require('./botHelpers');
const { getMenu } = require('./menuService');
const { parseIntent, looksLikeOrderText } = require('./intentParser');
const { matchIntentToMenu, mergeIntoBasket } = require('./intentMatcher');
const { splitPendingItems, startIntentCustomization } = require('./intentCustomize');

function buildIntentConfirmBody(matched, unmatched, lang) {
  const lines = matched.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`);
  const total = matched.reduce((s, i) => s + i.price * i.qty, 0);
  let body = t('intentConfirmHeader', lang) + '\n\n' + lines.join('\n') + '\n\n' + t('orderTotal', lang, total.toFixed(2));
  if (unmatched.length) {
    body += '\n\n' + t('intentUnmatched', lang, unmatched.join(', '));
  }
  body += '\n\n' + t('intentConfirmPrompt', lang);
  return body;
}

async function tryTextIntentOrder({ from, session, lang, businessId, basket, text, norm }) {
  if (!looksLikeOrderText(text, norm)) return false;

  const intent = parseIntent(text);
  if (!intent.items.length) return false;

  const menu = await getMenu(businessId);
  const { matched, unmatched } = matchIntentToMenu(intent, menu);
  if (!matched.length) return false;

  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingIntentItems: matched,
    unmatchedIntentItems: unmatched.length ? unmatched : undefined,
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: buildIntentConfirmBody(matched, unmatched, lang),
    buttons: [
      { id: 'btn_intent_confirm', title: t('intentConfirmBtn', lang) },
      { id: 'btn_intent_edit_menu', title: t('intentEditMenuBtn', lang) },
      { id: 'btn_intent_view_menu', title: t('viewMenuBtn', lang) },
    ],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
  return true;
}

async function handleIntentButtons({ from, session, lang, businessId, basket, id }) {
  if (id === 'btn_intent_confirm') {
    const live = await getSession(from);
    const pending = live.pendingIntentItems ?? [];
    const liveBasket = live.basket ?? basket;
    if (!pending.length) {
      await sendCatalog(from, lang, businessId);
      return true;
    }
    const { simple, customize } = splitPendingItems(pending);
    if (customize.length) {
      await startIntentCustomization({
        from, session: live, lang, businessId, basket: liveBasket, simpleItems: simple, customizeItems: customize,
      });
      return true;
    }
    const newBasket = mergeIntoBasket(liveBasket, pending);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket: newBasket,
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
      pendingDeleteIds: [],
    }, live);
    await sendButtonMessage(from, {
      body: buildBasketText(newBasket, lang),
      buttons: [
        { id: 'btn_add_more', title: t('addMoreBtn', lang) },
        { id: 'btn_view_basket', title: t('viewBasketBtn', lang) },
        { id: 'btn_confirm', title: t('confirmBtn', lang) },
      ],
    });
    return true;
  }

  if (id === 'btn_intent_edit_menu' || id === 'btn_intent_view_menu') {
    const { menuId } = await sendCatalog(from, lang, businessId);
    await patchSession(from, {
      state: 'browsing',
      language: lang,
      businessId,
      basket,
      pendingIntentItems: undefined,
      unmatchedIntentItems: undefined,
      menuId,
    }, session);
    return true;
  }

  return false;
}

module.exports = { tryTextIntentOrder, handleIntentButtons, buildIntentConfirmBody };
