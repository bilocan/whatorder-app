const { patchSession } = require('./sessionStore');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');
const { looksLikeNumberSelection, parseNumberSelection } = require('./textMenu');
const { getMenu } = require('./menuService');
const { sendIntentProposal } = require('./intentOrder');

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
  await sendIntentProposal({
    from, session, lang, businessId, basket,
    matched,
    unmatched: invalid,
  });
  return true;
}
module.exports = { tryNumberSelectionOrder };
