/**
 * Web keypad POC — maps session phase to wa.me prefill actions.
 * Each action sends plain text the bot already understands (or checkout keyword).
 */

const LABELS = {
  de: {
    viewBasket: 'Warenkorb',
    addMore: 'Mehr bestellen',
    checkout: 'Zur Kasse',
    fullMenu: 'Speisekarte',
    reorder: 'Wie letztes Mal',
    placeOrder: 'Bestellen',
    cancel: 'Abbrechen',
    clear: 'Warenkorb leeren',
    confirmProposal: 'Übernehmen',
    editOrder: 'Anpassen',
  },
  en: {
    viewBasket: 'View basket',
    addMore: 'Add more',
    checkout: 'Checkout',
    fullMenu: 'Full menu',
    reorder: 'Same as last',
    placeOrder: 'Place order',
    cancel: 'Cancel',
    clear: 'Clear basket',
    confirmProposal: 'Confirm',
    editOrder: 'Edit',
  },
  tr: {
    viewBasket: 'Sepet',
    addMore: 'Daha ekle',
    checkout: 'Ödeme',
    fullMenu: 'Tam menü',
    reorder: 'Geçen seferki gibi',
    placeOrder: 'Sipariş ver',
    cancel: 'İptal',
    clear: 'Sepeti temizle',
    confirmProposal: 'Onayla',
    editOrder: 'Düzenle',
  },
};

function resolvePhase(session = {}) {
  const state = session.state ?? 'browsing';
  const basket = session.basket ?? [];

  if (state === 'confirming') return 'confirming';
  if (session.pendingIntentItems?.length) return 'proposal';
  if (session.pendingReorderItems?.length) return 'reorder_offer';
  if (basket.length > 0 && (state === 'browsing' || state === 'selecting')) return 'has_basket';
  return 'empty';
}

function actionsForPhase(phase, lang = 'de') {
  const L = LABELS[lang] ?? LABELS.de;

  switch (phase) {
    case 'confirming':
      return [
        { id: 'place_order', text: 'yes', label: L.placeOrder, primary: true },
        { id: 'cancel', text: 'cancel', label: L.cancel },
      ];
    case 'proposal':
      return [
        { id: 'confirm_proposal', text: '', label: L.confirmProposal, primary: true, apiOnly: true },
        { id: 'menu', text: 'menu', label: L.editOrder },
        { id: 'cancel', text: 'cancel', label: L.cancel },
      ];
    case 'reorder_offer':
      return [
        { id: 'reorder_yes', text: 'yes', label: L.reorder, primary: true },
        { id: 'menu', text: 'menu', label: L.fullMenu },
      ];
    case 'has_basket':
      return [
        { id: 'checkout', text: 'checkout', label: L.checkout, primary: true },
        { id: 'menu', text: 'menu', label: L.addMore },
        { id: 'clear', text: '', label: L.clear, apiOnly: true },
      ];
    default:
      return [
        { id: 'menu', text: 'menu', label: L.fullMenu, primary: true },
        { id: 'reorder', text: 'hello', label: L.reorder },
      ];
  }
}

function buildKeypadContext(session, lang = 'de') {
  const basket = session.basket ?? [];
  const phase = resolvePhase(session);
  return {
    phase,
    state: session.state ?? 'browsing',
    basketCount: basket.length,
    basketTotal: basket.reduce((s, i) => s + (i.price ?? 0) * (i.qty ?? 1), 0),
    basket: basket.map((i) => ({
      name: i.name,
      qty: i.qty ?? 1,
      price: i.price ?? 0,
      lineTotal: (i.price ?? 0) * (i.qty ?? 1),
    })),
    pendingProposal: (session.pendingIntentItems ?? []).map((i) => ({
      name: i.name,
      qty: i.qty ?? 1,
      price: i.price ?? 0,
    })),
    actions: actionsForPhase(phase, lang),
  };
}

module.exports = { LABELS, resolvePhase, actionsForPhase, buildKeypadContext };
