const { patchSession } = require('./sessionStore');
const { sendText, sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { sendCatalog } = require('./botHelpers');
const { looksLikeNumberSelection, parseNumberSelection } = require('./textMenu');
const { getMenu } = require('./menuService');
const { buildIntentConfirmBody } = require('./intentOrder');

async function resolveTextMenuIndex(session, businessId) {
  if (session.textMenuIndex?.length) return session.textMenuIndex;
  if (!session.textMenuCategory) return null;
  const menu = await getMenu(businessId);
  const items = menu.filter(i => (i.category || 'other') === session.textMenuCategory);
  return items.length ? items.map(item => ({
    id: item.id,
    name: item.name,
    price: item.price,
    ...(item.optionGroups?.length ? { optionGroups: item.optionGroups } : {}),
  })) : null;
}

async function tryNumberSelectionOrder({ from, session, lang, businessId, basket, text }) {
  const textMenuIndex = await resolveTextMenuIndex(session, businessId);
  if (!looksLikeNumberSelection(text, textMenuIndex)) return false;

  const { matched, invalid } = parseNumberSelection(text, textMenuIndex);
  if (!matched.length) {
    await sendText(from, t('textMenuInvalid', lang, invalid.join(', ') || text.trim()));
    return true;
  }

  // Persist pending before outbound send — openCategoryMenu may still be patching menuId.
  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    textMenuIndex,
    ...(session.textMenuCategory ? { textMenuCategory: session.textMenuCategory } : {}),
    pendingIntentItems: matched,
    unmatchedIntentItems: invalid.length ? invalid : undefined,
  }, session);

  const msgId = await sendButtonMessage(from, {
    body: buildIntentConfirmBody(matched, invalid, lang),
    buttons: [
      { id: 'btn_intent_confirm', title: t('intentConfirmBtn', lang) },
      { id: 'btn_intent_edit_menu', title: t('intentEditMenuBtn', lang) },
      { id: 'btn_intent_view_menu', title: t('viewMenuBtn', lang) },
    ],
  });

  await patchSession(from, { pendingDeleteIds: msgId ? [msgId] : [] });
  return true;
}
module.exports = { tryNumberSelectionOrder };
