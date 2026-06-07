module.exports = {
  categories: { mains: 'Hauptgerichte', sides: 'Beilagen', drinks: 'Getränke' },

  greeting: (name) => `👋 Willkommen bei ${name}!\n\nÖffne unten die Speisekarte.`,
  langChanged: () => '✅ Sprache auf Deutsch geändert.',

  menuListHeader: (name) => `🍽️ ${name}`,
  menuListBody: () => 'Was möchten Sie bestellen?\nTippen Sie auf einen Artikel.',
  menuListFooter: () => 'Tippen zum Auswählen',
  viewMenuBtn: () => 'Menü anzeigen',

  qtyBody: (name, price) => `${name} — €${price}\n\nWie viele?`,

  itemAdded: (qty, name, count, total) => `✅ ${qty}x ${name} hinzugefügt.\n🛒 Warenkorb: ${count} Artikel — €${total}`,
  addMoreBtn: () => 'Mehr hinzufügen',
  viewBasketBtn: () => 'Warenkorb',
  doneBtn: () => 'Fertig',

  basketHeader: () => '🛒 Ihre Bestellung:',
  basketEmpty: () => 'Ihr Warenkorb ist leer. Wählen Sie etwas aus dem Menü.',
  clearBasketBtn: () => 'Löschen',
  confirmBtn: () => 'Bestätigen',

  orderTotal: (total) => `Gesamt: €${total}`,
  confirmPrompt: () => 'YES zum Bestätigen, NO zum Abbrechen.',
  yesNoOnly: () => 'Bitte YES oder NO schreiben.',
  orderConfirmed: (shortId) => `✅ Bestellung erhalten! Bestellnr.: #${shortId}\n\nWir benachrichtigen Sie wenn sie fertig ist. Danke! 🙏`,
  orderCancelled: () => 'Bestellung abgebrochen.',

  menuEmpty: () => 'Aktuell keine Artikel verfügbar.',
};
