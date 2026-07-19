module.exports = {
  categories: { mains: 'Hauptgerichte', sides: 'Beilagen', drinks: 'Getränke' },

  greeting: (name) => `👋 Willkommen bei ${name}!\n\nÖffne unten die Speisekarte.`,
  langChanged: () => '✅ Sprache auf Deutsch geändert.',

  menuListHeader: (name) => `🍽️ ${name}`,
  menuListBody: () => 'Was möchten Sie bestellen?\nTippen Sie auf einen Artikel.',
  menuListFooter: () => 'Tippen zum Auswählen',
  viewMenuBtn: () => 'Menü anzeigen',
  menuCategoryBody: () => 'Wählen Sie eine Kategorie. Danach folgt eine nummerierte Textliste.',
  menuCategoriesSection: () => 'Kategorien',
  menuCategoryCount: (count) => `${count} Artikel`,
  menuBackCategories: () => '← Alle Kategorien',
  menuNextPage: () => 'Weitere Artikel →',
  menuPrevPage: () => '← Zurück',
  menuMoreItemsDesc: (count) => `${count} weitere Artikel`,
  menuHeader: () => '📋 Speisekarte',
  menuExample: () => 'Oder Artikelnamen tippen, z. B. "2x Döner, 1 Ayran".',
  textMenuCategoryHeader: (category) => `📋 ${category}`,
  textMenuSelectHint: () => 'Mit Nummern antworten: 1, 3 oder 2x1 für 2× Artikel 1.',
  textMenuInvalid: (items) => `Nicht gefunden: ${items}. Bitte Nummern prüfen.`,
  textMenuPickCategory: () => 'Bitte zuerst eine Kategorie wählen, dann mit Nummern antworten.',
  textMenuContinued: (category, part) => `📋 ${category} (Fortsetzung ${part})`,
  textMenuContinuedHint: () => 'Weitere Artikel in der nächsten Nachricht…',

  qtyBody: (name, price) => `${name} — €${price}\n\nWie viele?`,

  itemAdded: (qty, name, count, total) => `✅ ${qty}× ${name} hinzugefügt.\n🛒 ${count} Artikel · €${total}`,
  itemsAdded: (addedQty, count, total) => `✅ ${addedQty} Artikel hinzugefügt.\n🛒 ${count} Artikel · €${total}`,
  itemRemoved: (name, count, total) => `✅ ${name} entfernt.\n🛒 ${count} Artikel · €${total}`,
  itemsRemoved: (removedQty, count, total) => `✅ ${removedQty} Artikel entfernt.\n🛒 ${count} Artikel · €${total}`,
  qtyUpdated: (name, qty, count, total) => `✅ ${name} → ${qty}×\n🛒 ${count} Artikel · €${total}`,
  basketMutated: (count, total) => `✅ Warenkorb aktualisiert.\n🛒 ${count} Artikel · €${total}`,
  basketUndone: (count, total) => `✅ Rückgängig gemacht.\n🛒 ${count} Artikel · €${total}`,
  basketNothingToUndo: () => 'Nichts zum Rückgängigmachen.',
  reorderLoaded: (count, total) => `✅ Gleiche Bestellung übernommen.\n🛒 ${count} Artikel · €${total}`,
  addMoreBtn: () => 'Mehr hinzufügen',
  viewBasketBtn: () => 'Warenkorb',
  doneBtn: () => 'Fertig',

  basketHeader: () => '🛒 Ihre Bestellung:',
  basketEmpty: () => 'Ihr Warenkorb ist leer. Wählen Sie etwas aus dem Menü.',
  clearBasketBtn: () => 'Löschen',
  removeItemBtn: () => 'Entfernen',
  basketRemoveHint: () =>
    'Was soll ich entfernen?\n\nBeispiele:\n• 1 oder 1, 3, 4\n• ohne ayran\n• döner und cola entfernen\n\nAbbrechen: abbrechen · Alles löschen: alles',
  basketRemoveNotFound: (text) => `"${text}" konnte ich nicht zuordnen. Versuch eine Zeilennummer oder einen Artikelnamen.`,
  basketRemoveAmbiguous: (linesText, count) => {
    const hint = count === 2
      ? 'Antwort: 1, 2, beide oder alle'
      : 'Antwort: Zeilennummer oder alle';
    return `Mehrere Treffer — welche Zeile soll ich entfernen?\n\n${linesText}\n\n${hint}`;
  },
  basketRemoveDisambigNotFound: () => 'Das habe ich nicht verstanden. Nenne eine Zeilennummer aus der Liste.',
  confirmBtn: () => 'Bestätigen',

  orderTotal: (total) => `Gesamt: €${total}`,
  confirmSummary: (basketText, prepMins, pickupTime) => `${basketText}\n⏱️ Fertig in ~${prepMins} Min. (gegen ${pickupTime})\n\nWie lautet Ihr Name?`,
  finalConfirmBody: (name, total, pickupTime, deliveryAddress, notes, paymentMethod) => {
    const detail = deliveryAddress
      ? `🚚 Lieferung an: ${deliveryAddress}`
      : `⏱️ Fertig gegen ${pickupTime}`;
    const notesLine = notes ? `\n📝 Notiz: ${notes}` : '';
    const paymentLine = paymentMethod === 'stripe' ? '\n💳 Zahlung: Karte' : '';
    return `✅ Fast fertig!\n\n👤 ${name}\n💶 Gesamt: €${total}\n${detail}${paymentLine}${notesLine}\n\nUnten tippen zum Bestätigen oder Ändern.`;
  },
  confirmListHeader: () => 'Bestellung prüfen',
  confirmListBtn: () => 'Optionen',
  confirmListSection: () => 'Optionen',
  confirmEditNameBtn: () => 'Name ändern',
  confirmEditAddressBtn: () => 'Adresse ändern',
  confirmEditOrderTypeBtn: () => 'Abholung/Lieferung',
  confirmOrderTypePickup: () => 'Abholung',
  confirmOrderTypeDelivery: () => 'Lieferung',
  confirmNoAddressYet: () => 'Noch keine Adresse',
  askNameEdit: (current) => `Aktueller Name: ${current}\n\nNeuen Namen eingeben:`,
  askOrderTypeFromConfirm: () => 'Abholung oder Lieferung für diese Bestellung:',
  confirmOrderBtn: () => 'Bestätigen ✅',
  addNoteBtn: () => 'Notiz hinzufügen 📝',
  backToCartBtn: () => 'Zum Warenkorb 🛒',
  addNotePrompt: () => 'Schreiben Sie Ihren besonderen Wunsch, Ihre Allergie oder Notiz.',
  confirmPrompt: () => 'YES zum Bestätigen, NO zum Abbrechen.',
  yesNoOnly: () => 'Bitte YES oder NO schreiben.',
  orderConfirmed: (shortId) => `✅ Bestellung erhalten! Bestellnr.: #${shortId}\n\nWir benachrichtigen Sie wenn sie fertig ist. Danke! 🙏`,
  orderReceipt: (shortId, restaurantName, itemLines, total, pickupTime, customerName, deliveryAddress, paymentMethod, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const restaurantBlock = contactLines ? `${restaurantName}\n${contactLines}` : restaurantName;
    const detail = deliveryAddress ? `Lieferung an: ${deliveryAddress}` : `Fertig um: ${pickupTime}`;
    return `✅ Bestellung #${shortId}\n\n${restaurantBlock}\n\n${itemLines}\n\nGesamt: €${total}\n${detail}\n\nDanke, ${customerName}! 🙏`;
  },
  checkoutCancelled: () => 'Bestellung abgebrochen.',
  cancelOrderBtn: () => 'Abbrechen',
  checkoutNameNotOrder: () => 'Das klingt nach einer Bestellung, nicht nach einem Namen. Wie lautet Ihr Name?',
  checkoutDigitClarify: () => 'Meinten Sie eine Zeilennummer aus dem Warenkorb? Bitte Artikelnamen tippen oder die Bestätigen-Schaltfläche nutzen.',
  checkoutBasketUpdated: (basketText) => `✅ Warenkorb aktualisiert.\n\n${basketText}`,
  checkoutAddressNotOrder: () => 'Das klingt nach einer Bestellung. Bitte geben Sie Ihre Lieferadresse ein, oder fügen Sie Artikel über den Warenkorb hinzu.',
  payNowBtn: () => 'Jetzt zahlen 💳',
  paymentLink: (shortId, itemLines, total, restaurantName, alertPhone, address, deliveryAddress) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const restaurantBlock = contactLines ? `${restaurantName}\n${contactLines}` : restaurantName;
    const detail = deliveryAddress ? `Lieferung an: ${deliveryAddress}` : null;
    return `Bestellung #${shortId} aufgegeben.\n\n${restaurantBlock}\n\n${itemLines}\n\nGesamt: €${total}${detail ? `\n${detail}` : ''}\n\nTippe unten auf den Button zum Bezahlen.`;
  },
  paymentLinkFailed: (shortId) => `Bestellung #${shortId} wurde erstellt, aber der Zahlungslink ist fehlgeschlagen. Bitte kontaktiere das Restaurant.`,
  paymentConfirmed: (shortId) => `✅ Zahlung für Bestellung #${shortId} erhalten. Wir melden uns, wenn sie fertig ist. Danke! 🙏`,
  paymentReturnSuccessTitle: () => 'Zahlung erhalten',
  paymentReturnCancelTitle: () => 'Zahlung abgebrochen',
  paymentReturnSuccessNoLink: () => 'Du kannst diese Seite schließen und zu WhatsApp zurückkehren.',
  paymentReturnCancelNoLink: () => 'Kehre zu WhatsApp zurück, um es erneut zu versuchen.',
  paymentReturnRedirecting: () => 'Zurück zu WhatsApp…',
  paymentReturnButton: () => 'Zu WhatsApp zurück',
  paymentReturnFallbackLink: () => 'Tippe hier, wenn der Button nicht funktioniert.',
  paymentReturnCloseHint: () => 'Du kannst diesen Tab schließen, nachdem du zurück bist.',

  menuEmpty: () => 'Aktuell keine Artikel verfügbar.',

  catalogBody: (name) => `👋 Willkommen bei ${name}!\n\nStöbern Sie im Menü und tippen Sie auf "In den Warenkorb". Wenn Sie fertig sind, senden Sie Ihren Warenkorb.`,
  catalogUnavailable: () => 'Unser Katalog ist noch nicht eingerichtet. Bitte kontaktieren Sie uns direkt.',

  askName: () => 'Wie lautet Ihr Name für die Bestellung?',

  orderApproved:  (shortId, etaTime) => `✅ Bestellung #${shortId} angenommen! Voraussichtlich fertig um ${etaTime}.`,
  orderPreparing: (shortId) => `👨‍🍳 Bestellung #${shortId} wird jetzt zubereitet!`,
  orderReady:     (shortId) => `✅ Ihre Bestellung #${shortId} ist abholbereit! Bis gleich 🙏`,
  orderOnTheWay:  (shortId) => `🚚 Bestellung #${shortId} ist unterwegs!`,
  orderPickedUp:  (shortId) => `✅ Bestellung #${shortId} abgeholt. Guten Appetit! 🙏`,
  orderDelivered: (shortId) => `✅ Bestellung #${shortId} zugestellt. Guten Appetit! 🙏`,
  orderRejected:  (shortId) => `❌ Leider konnte Bestellung #${shortId} nicht angenommen werden. Bitte kontaktieren Sie uns.`,
  orderCancelled: (shortId) => `❌ Bestellung #${shortId} wurde storniert.`,
  orderStatusPending: (shortId) => `⏳ Bestellung #${shortId} ist eingegangen und wartet auf Bestätigung durch das Restaurant.`,
  postOrderCallRestaurant: (name, phone) => phone
    ? `Für Änderungen an Ihrer Bestellung rufen Sie bitte ${name} an: ${phone}`
    : `Für Änderungen an Ihrer Bestellung kontaktieren Sie bitte ${name} direkt.`,
  postOrderCancelled: (shortId) => `✅ Bestellung #${shortId} wurde storniert.`,
  postOrderAmended: (shortId, itemLines, total) => `✅ Bestellung #${shortId} aktualisiert.\n\n${itemLines}\n\nNeuer Gesamtbetrag: €${total}`,
  humanHandoffOffer: () => 'Ich habe Schwierigkeiten, das zu verstehen. Möchten Sie, dass das Restaurant Ihnen antwortet?',
  humanHandoffBtn: () => 'Hilfe anfordern',
  humanHandoffConfirmed: () => 'Alles klar. Das Restaurant wurde benachrichtigt und meldet sich bei Ihnen.',
  postOrderOptions: (name) => name ? `🏪 ${name}\nWas möchtest du tun?` : 'Was möchtest du tun?',
  postCancelBtn: () => 'Stornieren',
  postReorderBtn: () => 'Nochmal bestellen',
  postRestaurantBtn: () => 'Restaurant wählen',
  postOrderCancelTooLate: (name, phone) => phone
    ? `Deine Bestellung wird bereits zubereitet. Für Änderungen ruf bitte ${name} an: ${phone}`
    : `Deine Bestellung wird bereits zubereitet. Bitte kontaktiere ${name} direkt.`,

  askOrderType: (fee) => `Wie möchten Sie Ihre Bestellung erhalten?\n\nLiefergebühr: €${Number(fee).toFixed(2)}`,
  pickupBtn: () => 'Abholung',
  deliveryBtn: () => 'Lieferung',
  askDeliveryAddress: () => '📍 Teilen Sie Ihren Standort oder geben Sie Ihre Lieferadresse ein.\n\nTipp: Straße + Hausnummer + PLZ (z. B. Beispielgasse 12, 1010 oder Beispielgasse 12/3 1010).',
  askDeliveryAddressShare: () => '📍 Bitte teilen Sie Ihren Lieferstandort.',
  deliveryAddressConfirm: (address) => `📍 Wir haben gefunden:\n*${address}*\n\nStimmt das?`,
  deliveryAddressConfirmYes: () => 'Ja',
  deliveryAddressConfirmEdit: () => 'Ändern',
  deliveryAddressInvalid: () => 'Diese Adresse konnten wir nicht prüfen. Bitte nochmal eingeben oder Standort teilen.',
  deliveryAddressGeocodeFailed: () => 'Aus dem Pin konnten wir keine Adresse lesen. Bitte Straße und Hausnummer tippen.',
  askDeliveryUnit: () => 'Welche Wohnung / welcher Eingang?\n\nAntworten Sie mit *Stiege / Tür / Top* (z. B. Top 14 oder Stiege 1, Top 8).\nOder *Haus*, wenn es keine Wohnungsnummer gibt.',
  deliveryUnitInvalid: () => 'Das sieht nicht nach einer Wohnung aus. Bitte z. B. *Top 14*, *Stiege 1, Top 8* oder *Haus* schreiben.',
  deliveryOutOfZone: () => 'Es tut uns leid, in dieses Gebiet liefern wir nicht. Bitte wählen Sie Abholung.',
  belowMinimumOrderValue: (minValue) => `Leider beträgt der Mindestbestellwert €${minValue}. Bitte fügen Sie noch etwas zu Ihrem Warenkorb hinzu.`,

  deliveryAddrPickerHeader: () => '📍 Lieferadresse',
  deliveryAddrPickerBody:   () => 'Wohin sollen wir Ihre Bestellung liefern?',
  deliveryAddrPickerBtn:    () => 'Adresse wählen',
  deliveryAddrSection:      () => 'Ihre Adressen',
  deliveryLocStart:         () => '📍 Geteilter Standort',
  deliverySavedAddr:        () => '🏠 Letzte Adresse',
  deliveryNewAddr:          () => '✏️ Adresse eingeben',
  deliveryShareLoc:         () => '📡 Standort senden',

  multiWelcomeBody: () => '👋 Willkommen bei WhatOrder!',
  locationRequestBody: () => '👋 Willkommen bei WhatOrder!\n\n📍 Standort teilen → nächste Restaurants auf der Karte.',
  switchLocationRequestBody: () => '👋 Willkommen bei WhatOrder!\n\n🔄 Restaurant gewechselt — Warenkorb geleert.\n\n📍 Standort teilen → nächste Restaurants auf der Karte.',
  restaurantPickerBody: () => 'Bei welchem Restaurant möchten Sie bestellen?',
  restaurantPickerButton: () => 'Restaurants',
  restaurantPickerFooter: () => 'Tippen Sie auf einen Namen um die Karte zu öffnen',
  restaurantPickerFooterNumbered: () => 'Nummern passen zur Karte (Karte öffnen)',
  interactiveMapBody: () => 'Bei welchem Restaurant möchten Sie bestellen?\n\nKarte öffnen → Markierung tippen → „Hier bestellen“.',
  interactiveMapBtn: () => 'Karte öffnen',
  noNearbyRestaurants: (maxKm) => `Keine Restaurants im Umkreis von ${maxKm} km. Antworten Sie mit *alle*, um alle Restaurants zu sehen.`,
  switchConfirmed: () => '🔄 Restaurant wird gewechselt. Ihr Warenkorb wurde geleert.',

  orderConfirmedWithChoice: (shortId, name, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const contactBlock = contactLines ? `\n\n${name}\n${contactLines}` : '';
    return `✅ Bestellung erhalten! Bestellnr.: #${shortId}${contactBlock}\n\nNochmals bei ${name} bestellen?`;
  },
  orderCancelledWithChoice: (name) => `❌ Bestellung abgebrochen.\n\nNochmals bei ${name} bestellen?`,
  orderAgainPrompt: (name) => `Bestellen Sie bei ${name}?\n\nHier weitermachen oder anderes Restaurant wählen.`,
  orderAgainBtn: () => 'Hier bestellen',
  chooseRestaurantBtn: () => 'Restaurant wählen',

  restaurantClosed: (name, firstOrderTime, lastOrderTime) =>
    firstOrderTime && lastOrderTime
      ? `🔒 ${name} ist derzeit geschlossen.\n\nBestellzeiten: ${firstOrderTime} – ${lastOrderTime}. Bis dann! 🙏`
      : `🔒 ${name} ist derzeit geschlossen. Bitte versuchen Sie es später! 🙏`,
  closedLabel: () => '🔒 Geschlossen',

  ordersClosedByOwner: (name) => `⏸️ ${name} nimmt gerade keine Bestellungen entgegen. Bitte versuchen Sie es später! 🙏`,
  deliveryClosedByOwner: () => '🚫 Lieferung ist derzeit nicht verfügbar. Bitte wählen Sie Abholung.',

  intentConfirmHeader: () => 'Verstanden:',
  intentConfirmPrompt: () => 'Zum Warenkorb hinzufügen?',
  intentConfirmBtn: () => 'Hinzufügen',
  intentChangeBtn: () => 'Ändern',
  intentEditMenuBtn: () => 'Menü ansehen',
  intentUnmatched: (items) => `Nicht gefunden: ${items}`,
  intentUnmatchedWithSuggestion: (name, list) => `"${name}" haben wir leider nicht. Meinten Sie?\n\n${list}\n\nTippe Zahl oder Namen.`,
  intentSpecialNote: (note) => `📝 Notiz: ${note}`,
  intentCustomizePrompt: (itemName, qty, groupLabel) => `${qty}x ${itemName}\n${groupLabel} wählen:`,
  intentCustomizeUnitPrompt: (unitIndex, unitTotal, itemName, groupLabel) => `${itemName} ${unitIndex}/${unitTotal}\n${groupLabel} wählen:`,
  intentSameOrEachPrompt: (qty, itemName) => `${qty}x ${itemName} bestellt.\nGleiche Optionen für alle oder einzeln anpassen?`,
  intentSameOptsBtn: () => 'Alle gleich',
  intentEachOptsBtn: () => 'Einzeln wählen',
  intentCustomizeSkip: () => 'Überspringen',
  intentChooseBtn: () => 'Wählen',
  intentMultiPrompt: (qty, itemName, groupLabel, optionList, defaultSummary) =>
    `${qty}x ${itemName}\n${groupLabel} — Standard: ${defaultSummary}.\nAntwort mit Auswahl (kommagetrennt) oder all / none:\n\n${optionList}\n\nBeispiel: Tomate, Salat`,
  intentMultiUnitPrompt: (unitIndex, unitTotal, itemName, groupLabel, optionList, defaultSummary) =>
    `${itemName} ${unitIndex}/${unitTotal}\n${groupLabel} — Standard: ${defaultSummary}.\nAntwort mit Auswahl (kommagetrennt) oder all / none:\n\n${optionList}`,
  intentMultiInvalid: (unmatched, optionList) =>
    `Nicht erkannt: ${unmatched}\n\nVerfügbar:\n${optionList}\n\nNochmal versuchen (kommagetrennt, all oder none):`,
  intentMultiDefaultAll: () => 'alles dabei',
  intentMultiDefaultNone: () => 'keine',
  intentMultiDefaultHint: () => 'Tippe Standard verwenden, oder antworte all / none / skip (nutzt Standard oben).',
  intentMultiDefaultBtn: () => 'Standard',

  reorderPromptHeader: (name) => `👋 Willkommen zurück bei ${name}! Deine letzte Bestellung:`,
  reorderConfirmPrompt: () => 'Gleich nochmal bestellen?',
  reorderConfirmBtn: () => 'Gleich wieder ✅',
  reorderBrowseBtn: () => 'Etwas anderes',
  reorderUnmatched: (items) => `Nicht mehr verfügbar: ${items}`,

  orderEntryBody: () =>
    'Was möchtest du bestellen?\n\nSchreib deine Bestellung, z. B. "2x Döner, 1 Ayran".\nOder tippe Beliebt, Suche oder Volles Menü.',
  popularBtn: () => 'Beliebt',
  searchBtn: () => 'Suche',
  viewFullMenuBtn: () => 'Volles Menü',
  popularHeader: () => 'Beliebt',
  popularBody: () => 'Die beliebtesten Gerichte. Tippe zum Hinzufügen.',
  popularSection: () => 'Beliebt',
  popularEmpty: () => 'Noch keine Beliebtheiten. Probier Suche oder Volles Menü.',
  searchPromptBody: () => 'Wonach suchst du?\n\nSchreib 1–2 Wörter, z. B. "pizza" oder "cola".',
  searchCancelBtn: () => 'Zurück',
  searchHeader: () => 'Suche',
  searchResultsBody: (query) => `Treffer für "${query}":`,
  searchSection: () => 'Treffer',
  searchNoResults: (query) => `Keine Treffer für "${query}". Anderes Wort oder Suche / Volles Menü.`,
  intentNoMatch: (text) => `"${text}" nicht auf der Karte. Probier Suche oder Volles Menü.`,
  intentParseFailed: () => 'Konnte die Bestellung nicht verstehen. Probier z. B. „2x Döner, 1 Ayran“ oder tippe Suche.',

  disambigHeader: () => 'Welches meinst du?',
  disambigBody: (rawName, qty) => `Du hast ${qty}x ${rawName} geschrieben. Welches Gericht?`,
  disambigUnitBody: (rawName, unitIndex, unitTotal) => `${rawName} ${unitIndex}/${unitTotal} — welches?`,
  disambigSameOrEachPrompt: (qty, rawName) =>
    `Du hast ${qty}x ${rawName} bestellt.\nAlle gleich oder einzeln auswählen?`,
  disambigSameBtn: () => 'Alle gleich',
  disambigEachBtn: () => 'Einzeln',
  disambigBtn: () => 'Wählen',
  disambigSection: () => 'Treffer',

  proposalEditHint: () =>
    'Was soll ich ändern?\n\nBeispiele:\n• ohne ayran\n• nur 1 döner\n• und 1 cola\n\nOder schick eine neue Bestellung.',
  proposalEditNotFound: (name) => `"${name}" ist nicht in deiner Bestellung. Versuch es nochmal oder tippe auf Hinzufügen.`,
  proposalEditEmpty: () => 'Deine Bestellung ist leer. Was möchtest du?',
};
