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

  catalogBody: (name) => `👋 Welcome to ${name}!\n\nBrowse the menu and tap "Add to Cart" on items you'd like to order. When you're done, send your cart.`,
  catalogUnavailable: () => 'Our catalog is not set up yet. Please contact us directly to order.',

  specialRequestsPrompt: () => 'Any special requests, allergies, or notes?\n\nType them here, or tap Skip if none.',
  skipBtn: () => 'Skip',
  askName: () => "What's your name for the order?",

  orderReady: (shortId) => `✅ Your order #${shortId} is ready for pickup! See you soon 🙏`,

  restaurantPickerBody: () => 'Which restaurant would you like to order from?',
  restaurantPickerButton: () => 'See restaurants',
  restaurantPickerFooter: () => 'Tap a name to open its menu',
  switchConfirmed: () => '🔄 Switching restaurants. Your basket has been cleared.',

  orderConfirmedWithChoice: (shortId, name) => `✅ Order received! Order #${shortId}\n\nOrder again from ${name}?`,
  orderCancelledWithChoice: (name) => `❌ Order cancelled.\n\nOrder again from ${name}?`,
  orderAgainPrompt: (name) => `Ordering from ${name}?\n\nContinue here or choose a different restaurant.`,
  orderAgainBtn: () => 'Order here again',
  chooseRestaurantBtn: () => 'Choose restaurant',
};
