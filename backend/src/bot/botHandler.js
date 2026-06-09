const { getSession, setSession } = require('./sessionStore');
const { getMenu, getBusinessInfo } = require('./menuService');
const { createOrder } = require('./orderService');
const { sendText, sendButtonMessage, sendCatalogMessage } = require('../lib/whatsapp');
const { detectLanguage, getOverride } = require('./languageDetector');
const { t } = require('./templates');

const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', '1', 'ok', 'tamam', 'confirm', 'onayla', 'bestätigen', 'bestatigen']);
const CANCEL  = new Set(['no', 'hayır', 'hayir', 'nein', 'cancel', 'iptal', '2']);

function buildCartText(cart, lang) {
  const lines = cart.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`);
  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  return `${t('basketHeader', lang)}\n\n${lines.join('\n')}\n\n${t('orderTotal', lang, total.toFixed(2))}`;
}

async function sendCatalog(to, lang, businessId, bodyOverride) {
  const info = await getBusinessInfo(businessId);
  if (!info.catalogId) {
    await sendText(to, t('catalogUnavailable', lang));
    return;
  }
  await sendCatalogMessage(to, info.catalogId, bodyOverride ?? t('catalogBody', lang, info.name));
}

// message shape:
//   { type: 'text', text }
//   { type: 'button_reply', id, title }
//   { type: 'cart_submitted', items: [{ productId, qty, price, currency }] }
async function handleMessage(businessId, { from, contactName, type, text, id, items }) {
  const session = await getSession(from);
  const norm = (text ?? '').trim().toLowerCase();

  // Language override (text only)
  if (type === 'text') {
    const overrideLang = getOverride(norm);
    if (overrideLang) {
      await setSession(from, { ...session, language: overrideLang });
      await sendText(from, t('langChanged', overrideLang));
      return;
    }
  }

  // First message (or session missing language) — detect language, open catalog
  if (!session.language) {
    const lang = type === 'text' ? detectLanguage(text) : 'tr';
    await setSession(from, { state: 'browsing', language: lang });
    await sendCatalog(from, lang, businessId);
    return;
  }

  const lang = session.language;

  // ── State: awaiting_special_requests ─────────────────────────────────────
  if (session.state === 'awaiting_special_requests') {
    const isSkip = type === 'button_reply' && id === 'btn_skip_requests';
    const notes = isSkip ? '' : (type === 'text' && norm.length > 0 ? text.trim() : null);

    if (notes !== null) {
      await setSession(from, { ...session, state: 'awaiting_name', specialRequests: notes });
      await sendText(from, t('askName', lang));
      return;
    }
    // Unexpected input — re-prompt
    await sendButtonMessage(from, {
      body: t('specialRequestsPrompt', lang),
      buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
    });
    return;
  }

  // ── State: awaiting_name ──────────────────────────────────────────────────
  if (session.state === 'awaiting_name') {
    if (type === 'text' && norm.length > 0) {
      const name = text.trim().slice(0, 60);
      const cart = session.pendingCart ?? [];
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      await setSession(from, { ...session, state: 'confirming', customerName: name });
      await sendButtonMessage(from, {
        body: t('finalConfirmBody', lang, name, total.toFixed(2), session.pickupTime),
        buttons: [
          { id: 'btn_place_order',  title: t('confirmOrderBtn', lang) },
          { id: 'btn_cancel_order', title: t('cancelOrderBtn', lang) },
        ],
      });
      return;
    }
    const cart = session.pendingCart ?? [];
    await sendText(from, t('confirmSummary', lang, buildCartText(cart, lang), session.prepMins, session.pickupTime));
    return;
  }

  // ── State: confirming ─────────────────────────────────────────────────────
  if (session.state === 'confirming') {
    const isConfirm = (type === 'button_reply' && id === 'btn_place_order') || CONFIRM.has(norm);
    const isCancel  = (type === 'button_reply' && id === 'btn_cancel_order') || CANCEL.has(norm);

    if (isConfirm) {
      const cart = session.pendingCart ?? [];
      const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
      const orderId = await createOrder(businessId, {
        customerPhone: from,
        customerName: session.customerName || contactName || null,
        items: cart,
        total,
        language: lang,
        pickupTime: session.pickupTime || null,
        notes: session.specialRequests || null,
      });
      const shortId = orderId.slice(-6).toUpperCase();
      await setSession(from, { state: 'browsing', language: lang });
      await sendText(from, t('orderConfirmed', lang, shortId));
      return;
    }

    if (isCancel) {
      await setSession(from, { state: 'browsing', language: lang });
      await sendCatalog(from, lang, businessId, t('orderCancelled', lang));
      return;
    }

    await sendText(from, t('yesNoOnly', lang));
    return;
  }

  // ── State: browsing ───────────────────────────────────────────────────────

  // Customer submitted their WhatsApp cart
  if (type === 'cart_submitted') {
    if (!items || !items.length) {
      await sendCatalog(from, lang, businessId);
      return;
    }
    // Resolve catalog product IDs → menu item names
    const menu = await getMenu(businessId);
    const cart = items.map(item => {
      const menuItem = menu.find(m => m.id === item.productId);
      return {
        name: menuItem?.name ?? item.productId,
        qty: item.qty,
        price: item.price,
      };
    });
    const info = await getBusinessInfo(businessId);
    const prepMins = info.avgPrepTime || 30;
    const pickupTime = new Date(Date.now() + prepMins * 60000)
      .toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });

    await setSession(from, { state: 'awaiting_special_requests', language: lang, pendingCart: cart, pickupTime, prepMins });
    await sendButtonMessage(from, {
      body: t('specialRequestsPrompt', lang),
      buttons: [{ id: 'btn_skip_requests', title: t('skipBtn', lang) }],
    });
    return;
  }

  // Default: show catalog
  await sendCatalog(from, lang, businessId);
}

module.exports = { handleMessage };
