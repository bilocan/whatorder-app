const messages = {
  greeting: {
    tr: (name) => `👋 ${name}'a hoş geldiniz!\n\nMenüyü görmek için "menü" yazın.`,
    de: (name) => `👋 Willkommen bei ${name}!\n\nSchreib "menü" um die Speisekarte zu sehen.`,
    en: (name) => `👋 Welcome to ${name}!\n\nType "menu" to see our menu.`,
  },
  langChanged: {
    tr: () => '✅ Dil Türkçe olarak değiştirildi.',
    de: () => '✅ Sprache auf Deutsch geändert.',
    en: () => '✅ Language changed to English.',
  },
  menuEmpty: {
    tr: () => 'Şu an menümüzde ürün yok.',
    de: () => 'Aktuell keine Artikel verfügbar.',
    en: () => 'No items available right now.',
  },
  menuHeader: {
    tr: () => 'Menümüz:',
    de: () => 'Unsere Speisekarte:',
    en: () => 'Our menu:',
  },
  menuExample: {
    tr: () => 'Sipariş vermek için yazın:\nÖrnek: 2x Döner + 1 Cola',
    de: () => 'Zum Bestellen schreib:\nBeispiel: 2x Döner + 1 Cola',
    en: () => 'To order, type:\nExample: 2x Döner + 1 Cola',
  },
  itemNotFound: {
    tr: (names) => `❌ Menüde bulunamadı: ${names}`,
    de: (names) => `❌ Nicht im Menü gefunden: ${names}`,
    en: (names) => `❌ Not found in menu: ${names}`,
  },
  orderSummaryHeader: {
    tr: () => 'Siparişiniz:',
    de: () => 'Ihre Bestellung:',
    en: () => 'Your order:',
  },
  orderTotal: {
    tr: (total) => `Toplam: €${total}`,
    de: (total) => `Gesamt: €${total}`,
    en: (total) => `Total: €${total}`,
  },
  confirmPrompt: {
    tr: () => 'Onaylamak için YES, iptal için NO yazın.',
    de: () => 'YES zum Bestätigen, NO zum Abbrechen.',
    en: () => 'Type YES to confirm, NO to cancel.',
  },
  yesNoOnly: {
    tr: () => 'Lütfen YES veya NO yazın.',
    de: () => 'Bitte YES oder NO schreiben.',
    en: () => 'Please type YES or NO.',
  },
  orderConfirmed: {
    tr: (shortId) => `✅ Siparişiniz alındı! Sipariş no: #${shortId}\n\nHazır olduğunda size bildireceğiz. Teşekkürler! 🙏`,
    de: (shortId) => `✅ Bestellung erhalten! Bestellnr.: #${shortId}\n\nWir benachrichtigen Sie wenn sie fertig ist. Danke! 🙏`,
    en: (shortId) => `✅ Order received! Order #${shortId}\n\nWe'll notify you when it's ready. Thank you! 🙏`,
  },
  orderCancelled: {
    tr: () => 'Sipariş iptal edildi.',
    de: () => 'Bestellung abgebrochen.',
    en: () => 'Order cancelled.',
  },
};

function t(key, lang, ...args) {
  const fn = messages[key]?.[lang] ?? messages[key]?.en;
  return fn ? fn(...args) : `[${key}]`;
}

module.exports = { t };
