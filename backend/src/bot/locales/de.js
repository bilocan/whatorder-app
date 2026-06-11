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
  finalConfirmBody: (name, total, pickupTime, deliveryAddress) => {
    const detail = deliveryAddress
      ? `🚚 Lieferung an: ${deliveryAddress}`
      : `⏱️ Fertig gegen ${pickupTime}`;
    return `✅ Fast fertig!\n\n👤 ${name}\n💶 Gesamt: €${total}\n${detail}\n\nBestellung bestätigen?`;
  },
  confirmOrderBtn: () => 'Bestätigen ✅',
  cancelOrderBtn: () => 'Abbrechen ❌',
  confirmPrompt: () => 'YES zum Bestätigen, NO zum Abbrechen.',
  yesNoOnly: () => 'Bitte YES oder NO schreiben.',
  orderConfirmed: (shortId) => `✅ Bestellung erhalten! Bestellnr.: #${shortId}\n\nWir benachrichtigen Sie wenn sie fertig ist. Danke! 🙏`,
  orderReceipt: (shortId, restaurantName, itemLines, total, pickupTime, customerName, deliveryAddress) => {
    const detail = deliveryAddress ? `Lieferung an: ${deliveryAddress}` : `Fertig um: ${pickupTime}`;
    return `✅ Bestellung #${shortId}\n\n${restaurantName}\n\n${itemLines}\n\nGesamt: €${total}\n${detail}\n\nDanke, ${customerName}! 🙏`;
  },
  orderCancelled: () => 'Bestellung abgebrochen.',

  menuEmpty: () => 'Aktuell keine Artikel verfügbar.',

  catalogBody: (name) => `👋 Willkommen bei ${name}!\n\nStöbern Sie im Menü und tippen Sie auf "In den Warenkorb". Wenn Sie fertig sind, senden Sie Ihren Warenkorb.`,
  catalogUnavailable: () => 'Unser Katalog ist noch nicht eingerichtet. Bitte kontaktieren Sie uns direkt.',

  specialRequestsPrompt: () => 'Haben Sie besondere Wünsche, Allergien oder Anmerkungen?\n\nTippen Sie diese hier ein oder tippen Sie auf Überspringen.',
  skipBtn: () => 'Überspringen',
  askName: () => 'Wie lautet Ihr Name für die Bestellung?',

  orderReady: (shortId) => `✅ Ihre Bestellung #${shortId} ist abholbereit! Bis gleich 🙏`,

  askOrderType: (fee) => `Wie möchten Sie Ihre Bestellung erhalten?\n\nLiefergebühr: €${Number(fee).toFixed(2)}`,
  pickupBtn: () => 'Abholung',
  deliveryBtn: () => 'Lieferung',
  askDeliveryAddress: () => '📍 Teilen Sie Ihren Standort oder geben Sie Ihre Lieferadresse ein.',
  deliveryOutOfZone: () => 'Es tut uns leid, in dieses Gebiet liefern wir nicht. Bitte wählen Sie Abholung.',

  deliveryAddrPickerHeader: () => '📍 Lieferadresse',
  deliveryAddrPickerBody:   () => 'Wohin sollen wir Ihre Bestellung liefern?',
  deliveryAddrPickerBtn:    () => 'Adresse wählen',
  deliveryAddrSection:      () => 'Ihre Adressen',
  deliveryLocStart:         () => '📍 Geteilter Standort',
  deliverySavedAddr:        () => '🏠 Letzte Adresse',
  deliveryNewAddr:          () => '✏️ Adresse eingeben',
  deliveryShareLoc:         () => '📡 Standort senden',

  locationRequestBody: () => '📍 Teilen Sie Ihren Standort und wir zeigen Ihnen die nächsten Restaurants zuerst.\n\nOder schreiben Sie einfach etwas, um alle Restaurants zu sehen.',
  restaurantPickerBody: () => 'Bei welchem Restaurant möchten Sie bestellen?',
  restaurantPickerButton: () => 'Restaurants',
  restaurantPickerFooter: () => 'Tippen Sie auf einen Namen um die Karte zu öffnen',
  switchConfirmed: () => '🔄 Restaurant wird gewechselt. Ihr Warenkorb wurde geleert.',

  orderConfirmedWithChoice: (shortId, name) => `✅ Bestellung erhalten! Bestellnr.: #${shortId}\n\nNochmals bei ${name} bestellen?`,
  orderCancelledWithChoice: (name) => `❌ Bestellung abgebrochen.\n\nNochmals bei ${name} bestellen?`,
  orderAgainPrompt: (name) => `Bestellen Sie bei ${name}?\n\nHier weitermachen oder anderes Restaurant wählen.`,
  orderAgainBtn: () => 'Hier bestellen',
  chooseRestaurantBtn: () => 'Restaurant wählen',
};
