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
  confirmSummary: (basketText, prepMins, pickupTime) => `${basketText}\n⏱️ Fertig in ~${prepMins} Min. (gegen ${pickupTime})\n\nWie lautet Ihr Name?`,
  finalConfirmBody: (name, total, pickupTime) => `✅ Fast fertig!\n\n👤 ${name}\n💶 Gesamt: €${total}\n⏱️ Fertig gegen ${pickupTime}\n\nBestellung bestätigen?`,
  confirmOrderBtn: () => 'Bestätigen ✅',
  cancelOrderBtn: () => 'Abbrechen ❌',
  confirmPrompt: () => 'YES zum Bestätigen, NO zum Abbrechen.',
  yesNoOnly: () => 'Bitte YES oder NO schreiben.',
  orderConfirmed: (shortId) => `✅ Bestellung erhalten! Bestellnr.: #${shortId}\n\nWir benachrichtigen Sie wenn sie fertig ist. Danke! 🙏`,
  orderCancelled: () => 'Bestellung abgebrochen.',

  menuEmpty: () => 'Aktuell keine Artikel verfügbar.',

  catalogBody: (name) => `👋 Willkommen bei ${name}!\n\nStöbern Sie im Menü und tippen Sie auf "In den Warenkorb". Wenn Sie fertig sind, senden Sie Ihren Warenkorb.`,
  catalogUnavailable: () => 'Unser Katalog ist noch nicht eingerichtet. Bitte kontaktieren Sie uns direkt.',

  specialRequestsPrompt: () => 'Haben Sie besondere Wünsche, Allergien oder Anmerkungen?\n\nTippen Sie diese hier ein oder tippen Sie auf Überspringen.',
  skipBtn: () => 'Überspringen',
  askName: () => 'Wie lautet Ihr Name für die Bestellung?',

  orderReady: (shortId) => `✅ Ihre Bestellung #${shortId} ist abholbereit! Bis gleich 🙏`,
};
