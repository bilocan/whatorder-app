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

async function sendOrderEntryPrompt({ from, session, lang, businessId, basket = [], bodyOverride }) {
  const msgId = await sendButtonMessage(from, {
    body: bodyOverride ?? t('orderEntryBody', lang),
    buttons: [
      { id: 'btn_view_full_menu', title: t('viewFullMenuBtn', lang) },
    ],
  });
  await patchSession(from, {
    state: 'browsing',
    language: lang,
    businessId,
    basket,
    pendingDeleteIds: msgId ? [msgId] : [],
  }, session);
  return true;
}

module.exports = { isMenuRequest, sendOrderEntryPrompt, MENU_KEYWORDS };
