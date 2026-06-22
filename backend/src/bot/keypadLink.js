const { sendText, sendButtonMessage, sendCtaUrlMessage } = require('../lib/whatsapp');
const { t } = require('./templates');
const { buildBasketText } = require('./botHelpers');

const KEYPAD_KEYWORDS = new Set([
  'keypad', 'buttons', 'keyboard', 'tastatur', 'klavye', 'tuşlar', 'tuslar',
]);

const DEFAULT_BASKET_BUTTONS = (lang) => [
  { id: 'btn_add_more', title: t('addMoreBtn', lang) },
  { id: 'btn_clear_basket', title: t('clearBasketBtn', lang) },
  { id: 'btn_confirm', title: t('confirmBtn', lang) },
];

function getKeypadBaseUrl() {
  return (process.env.KEYPAD_BASE_URL || '').replace(/\/$/, '');
}

function buildKeypadUrl(businessId, customerPhone, lang = 'de') {
  const base = getKeypadBaseUrl();
  if (!base || !businessId) return null;
  const customer = String(customerPhone ?? '').replace(/\D/g, '');
  const qs = new URLSearchParams({ lang });
  if (customer) qs.set('customer', customer);
  return `${base}/keypad/${encodeURIComponent(businessId)}?${qs}`;
}

async function sendKeypadCtaIfConfigured(from, lang, businessId) {
  const url = buildKeypadUrl(businessId, from, lang);
  if (!url) return false;
  await sendCtaUrlMessage(from, {
    body: t('keypadCtaBody', lang),
    buttonLabel: t('keypadCtaBtn', lang),
    url,
  });
  return true;
}

/** Basket reply buttons + separate tappable CTA URL message (raw LAN URLs are not clickable in WA text). */
async function sendBasketWithKeypad({ from, lang, businessId, basket, buttons }) {
  await sendButtonMessage(from, { body: buildBasketText(basket, lang), buttons });
  await sendKeypadCtaIfConfigured(from, lang, businessId);
}

async function sendKeypadLink({ from, lang, businessId, basket = [] }) {
  const sent = await sendKeypadCtaIfConfigured(from, lang, businessId);
  if (!sent) {
    await sendText(from, t('keypadNotConfigured', lang));
    return;
  }
  if (basket.length) {
    await sendButtonMessage(from, {
      body: buildBasketText(basket, lang),
      buttons: DEFAULT_BASKET_BUTTONS(lang),
    });
  }
}

module.exports = {
  KEYPAD_KEYWORDS,
  getKeypadBaseUrl,
  buildKeypadUrl,
  sendKeypadCtaIfConfigured,
  sendBasketWithKeypad,
  sendKeypadLink,
};
