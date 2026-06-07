const { getSession, setSession } = require('./sessionStore');
const { parseOrderText } = require('./orderParser');
const { getMenu, getBusinessInfo, formatMenuText, matchMenuItem } = require('./menuService');
const { createOrder } = require('./orderService');
const { sendText } = require('../lib/whatsapp');
const { detectLanguage, getOverride } = require('./languageDetector');
const { t } = require('./templates');

const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', '1', 'ok', 'tamam', 'confirm']);
const CANCEL  = new Set(['no', 'hayır', 'hayir', 'nein', 'cancel', 'iptal', '2']);

async function handleMessage(businessId, { from, text, contactName }) {
  const session = await getSession(from);
  const norm = text.trim().toLowerCase();

  // Language override: "english" / "deutsch" / "türkçe"
  const overrideLang = getOverride(norm);
  if (overrideLang) {
    await setSession(from, { ...session, language: overrideLang });
    await sendText(from, t('langChanged', overrideLang));
    return;
  }

  // First message: detect language, send greeting
  if (!session.language) {
    const lang = detectLanguage(text);
    const info = await getBusinessInfo(businessId);
    await setSession(from, { state: 'idle', language: lang });
    await sendText(from, t('greeting', lang, info.name));
    return;
  }

  const lang = session.language;

  if (session.state === 'confirming') {
    if (CONFIRM.has(norm)) {
      const orderId = await createOrder(businessId, {
        customerPhone: from,
        customerName: contactName || null,
        items: session.items,
        total: session.total,
      });
      const shortId = orderId.slice(-6).toUpperCase();
      await setSession(from, { state: 'idle', language: lang });
      await sendText(from, t('orderConfirmed', lang, shortId));
      return;
    }

    if (CANCEL.has(norm)) {
      const menu = await getMenu(businessId);
      await setSession(from, { state: 'idle', language: lang });
      await sendText(from, t('orderCancelled', lang) + '\n\n' + formatMenuText(menu, lang));
      return;
    }

    await sendText(from, t('yesNoOnly', lang));
    return;
  }

  // Try to parse as an order
  const parsed = parseOrderText(text);
  if (parsed.length > 0) {
    const menu = await getMenu(businessId);
    const items = [];
    const unrecognized = [];

    for (const { qty, rawName } of parsed) {
      const match = matchMenuItem(rawName, menu);
      if (match) {
        items.push({ name: match.name, qty, price: match.price });
      } else {
        unrecognized.push(rawName);
      }
    }

    if (unrecognized.length > 0) {
      await sendText(from, t('itemNotFound', lang, unrecognized.join(', ')) + '\n\n' + formatMenuText(menu, lang));
      return;
    }

    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const summary = items.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');

    await setSession(from, { state: 'confirming', language: lang, items, total });
    await sendText(from, `${t('orderSummaryHeader', lang)}\n\n${summary}\n\n${t('orderTotal', lang, total.toFixed(2))}\n\n${t('confirmPrompt', lang)}`);
    return;
  }

  // Default: show menu
  const menu = await getMenu(businessId);
  await sendText(from, formatMenuText(menu, lang));
}

module.exports = { handleMessage };
