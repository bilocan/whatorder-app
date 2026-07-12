const { patchSession } = require('./sessionStore');
const { sendButtonMessage } = require('../lib/whatsapp');
const { t } = require('./templates');

const MENU_KEYWORDS = new Set([
  'menu', 'menü', 'menue', 'menüyü', 'menüyü göster', 'show menu', 'browse',
  'katalog', 'catalog', 'speisekarte', 'menüyü aç', 'tam menü', 'full menu',
]);

function isMenuRequest(norm) {
  const cleaned = (norm ?? '').replace(/[!?.]+/g, '').trim();
  return MENU_KEYWORDS.has(cleaned);
}

async function buildOrderEntryButtons(lang, businessId) {
  const { hasPopularItems } = require('./popularBoard');
  const buttons = [];
  if (await hasPopularItems(businessId)) {
    buttons.push({ id: 'btn_popular', title: t('popularBtn', lang) });
  }
  buttons.push({ id: 'btn_search', title: t('searchBtn', lang) });
  buttons.push({ id: 'btn_view_full_menu', title: t('viewFullMenuBtn', lang) });
  return buttons.slice(0, 3);
}

async function sendOrderEntryPrompt({ from, session, lang, businessId, basket = [], bodyOverride, fresh = false }) {
  const buttons = await buildOrderEntryButtons(lang, businessId);
  const msgId = await sendButtonMessage(from, {
    body: bodyOverride ?? t('orderEntryBody', lang),
    buttons,
  });
  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    menuSearchActive: false,
    pendingDeleteIds: msgId ? [msgId] : [],
    pendingAmendOrderId: undefined,
    pendingAmendBusinessId: undefined,
    pendingAmendPlacedAt: undefined,
    ...(fresh ? { specialRequests: undefined } : {}),
  }, session);
  return true;
}

module.exports = {
  isMenuRequest,
  sendOrderEntryPrompt,
  buildOrderEntryButtons,
  MENU_KEYWORDS,
};
