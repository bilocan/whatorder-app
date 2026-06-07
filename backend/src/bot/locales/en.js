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
  confirmPrompt: () => 'Type YES to confirm, NO to cancel.',
  yesNoOnly: () => 'Please type YES or NO.',
  orderConfirmed: (shortId) => `✅ Order received! Order #${shortId}\n\nWe'll notify you when it's ready. Thank you! 🙏`,
  orderCancelled: () => 'Order cancelled.',

  menuEmpty: () => 'No items available right now.',
};
