module.exports = {
  categories: { mains: 'Mains', sides: 'Sides', drinks: 'Drinks' },

  greeting: (name) => `👋 Welcome to ${name}!\n\nOpen the menu below.`,
  langChanged: () => '✅ Language changed to English.',

  menuListHeader: (name) => `🍽️ ${name}`,
  menuListBody: () => 'What would you like to order?\nTap an item to select.',
  menuListFooter: () => 'Tap to select',
  viewMenuBtn: () => 'View Menu',

  qtyBody: (name, price) => `${name} — €${price}\n\nHow many?`,

  itemAdded: (qty, name, count, total) => `✅ ${qty}x ${name} added.\n🛒 Basket: ${count} item${count !== 1 ? 's' : ''} — €${total}`,
  addMoreBtn: () => 'Add more',
  viewBasketBtn: () => 'View basket',
  doneBtn: () => 'Done',

  basketHeader: () => '🛒 Your order:',
  basketEmpty: () => 'Your basket is empty. Select an item from the menu.',
  clearBasketBtn: () => 'Clear basket',
  confirmBtn: () => 'Confirm',

  orderTotal: (total) => `Total: €${total}`,
  confirmSummary: (basketText, prepMins, pickupTime) => `${basketText}\n⏱️ Ready in ~${prepMins} min (around ${pickupTime})\n\nWhat's your name for the order?`,
  finalConfirmBody: (name, total, pickupTime) => `✅ Almost done!\n\n👤 ${name}\n💶 Total: €${total}\n⏱️ Ready around ${pickupTime}\n\nConfirm your order?`,
  confirmOrderBtn: () => 'Confirm ✅',
  cancelOrderBtn: () => 'Cancel ❌',
  confirmPrompt: () => 'Type YES to confirm, NO to cancel.',
  yesNoOnly: () => 'Please type YES or NO.',
  orderConfirmed: (shortId) => `✅ Order received! Order #${shortId}\n\nWe'll notify you when it's ready. Thank you! 🙏`,
  orderCancelled: () => 'Order cancelled.',

  menuEmpty: () => 'No items available right now.',

  orderReady: (shortId) => `✅ Your order #${shortId} is ready for pickup! See you soon 🙏`,
};
