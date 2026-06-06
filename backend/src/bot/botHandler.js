const { getSession, setSession, clearSession } = require('./sessionStore');
const { parseOrderText } = require('./orderParser');
const { getMenu, formatMenuText, matchMenuItem } = require('./menuService');
const { createOrder } = require('./orderService');
const { sendText } = require('../lib/whatsapp');

const CONFIRM = new Set(['yes', 'evet', 'ja', 'oui', 'si', '1', 'ok', 'tamam', 'confirm']);
const CANCEL  = new Set(['no', 'hayır', 'nein', 'cancel', 'iptal', '2']);

async function handleMessage(businessId, { from, text, contactName }) {
  const session = getSession(from);
  const norm = text.trim().toLowerCase();

  if (session.state === 'confirming') {
    if (CONFIRM.has(norm)) {
      const orderId = await createOrder(businessId, {
        customerPhone: from,
        customerName: contactName || null,
        items: session.items,
        total: session.total,
      });
      clearSession(from);
      const shortId = orderId.slice(-6).toUpperCase();
      await sendText(from, `✅ Siparişiniz alındı! Sipariş no: #${shortId}\n\nHazır olduğunda size bildireceğiz. Teşekkürler! 🙏`);
      return;
    }

    if (CANCEL.has(norm)) {
      clearSession(from);
      const menu = await getMenu(businessId);
      await sendText(from, 'Sipariş iptal edildi.\n\n' + formatMenuText(menu));
      return;
    }

    await sendText(from, 'Onaylamak için YES, iptal etmek için NO yazın.');
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
      await sendText(from, `❌ Menüde bulunamadı: ${unrecognized.join(', ')}\n\n${formatMenuText(menu)}`);
      return;
    }

    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const summary = items.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');

    setSession(from, { state: 'confirming', items, total });
    await sendText(from, `Siparişiniz:\n\n${summary}\n\nToplam: €${total.toFixed(2)}\n\nOnaylamak için YES, iptal için NO yazın.`);
    return;
  }

  // Default: show menu
  const menu = await getMenu(businessId);
  await sendText(from, formatMenuText(menu));
}

module.exports = { handleMessage };
