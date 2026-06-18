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
  finalConfirmBody: (name, total, pickupTime, deliveryAddress) => {
    const detail = deliveryAddress
      ? `🚚 Delivery to: ${deliveryAddress}`
      : `⏱️ Ready around ${pickupTime}`;
    return `✅ Almost done!\n\n👤 ${name}\n💶 Total: €${total}\n${detail}\n\nConfirm your order?`;
  },
  confirmOrderBtn: () => 'Confirm ✅',
  cancelOrderBtn: () => 'Cancel ❌',
  confirmPrompt: () => 'Type YES to confirm, NO to cancel.',
  yesNoOnly: () => 'Please type YES or NO.',
  orderConfirmed: (shortId) => `✅ Order received! Order #${shortId}\n\nWe'll notify you when it's ready. Thank you! 🙏`,
  orderReceipt: (shortId, restaurantName, itemLines, total, pickupTime, customerName, deliveryAddress, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const restaurantBlock = contactLines ? `${restaurantName}\n${contactLines}` : restaurantName;
    const detail = deliveryAddress ? `Delivery to: ${deliveryAddress}` : `Ready by: ${pickupTime}`;
    return `✅ Order #${shortId}\n\n${restaurantBlock}\n\n${itemLines}\n\nTotal: €${total}\n${detail}\n\nThanks, ${customerName}! 🙏`;
  },
  orderCancelled: () => 'Order cancelled.',

  menuEmpty: () => 'No items available right now.',

  catalogBody: (name) => `👋 Welcome to ${name}!\n\nBrowse the menu and tap "Add to Cart" on items you'd like to order. When you're done, send your cart.`,
  catalogUnavailable: () => 'Our catalog is not set up yet. Please contact us directly to order.',

  specialRequestsPrompt: () => 'Any special requests, allergies, or notes?\n\nType them here, or tap Skip if none.',
  skipBtn: () => 'Skip',
  editCartBtn:  () => 'Edit cart',
  editCartBody: () => 'Tap below to edit your cart.',
  askName: () => "What's your name for the order?",

  orderApproved:  (shortId) => `✅ Order #${shortId} accepted! We'll start preparing it shortly.`,
  orderPreparing: (shortId) => `👨‍🍳 Order #${shortId} is now being prepared!`,
  orderReady:     (shortId) => `✅ Your order #${shortId} is ready for pickup! See you soon 🙏`,
  orderOnTheWay:  (shortId) => `🚚 Order #${shortId} is on its way!`,
  orderPickedUp:  (shortId) => `✅ Thanks for picking up order #${shortId}. Enjoy your meal! 🙏`,
  orderDelivered: (shortId) => `✅ Order #${shortId} delivered. Enjoy your meal! 🙏`,
  orderRejected:  (shortId) => `❌ Sorry, order #${shortId} could not be accepted. Please contact us.`,
  orderCancelled: (shortId) => `❌ Order #${shortId} has been cancelled.`,

  askOrderType: (fee) => `How would you like to receive your order?\n\nDelivery fee: €${Number(fee).toFixed(2)}`,
  pickupBtn: () => 'Pickup',
  deliveryBtn: () => 'Delivery',
  askDeliveryAddress: () => '📍 Share your location or type your delivery address.',
  deliveryOutOfZone: () => "Sorry, we don't deliver to that area. Please choose pickup instead.",

  deliveryAddrPickerHeader: () => '📍 Delivery address',
  deliveryAddrPickerBody:   () => 'Where should we deliver your order?',
  deliveryAddrPickerBtn:    () => 'Choose address',
  deliveryAddrSection:      () => 'Your addresses',
  deliveryLocStart:         () => '📍 Location you shared',
  deliverySavedAddr:        () => '🏠 Your last address',
  deliveryNewAddr:          () => '✏️ Enter new address',
  deliveryShareLoc:         () => '📡 Share location',

  locationRequestBody: () => '📍 Share your location and we\'ll show the nearest restaurants first.\n\nOr just reply with anything to see all restaurants.',
  restaurantPickerBody: () => 'Which restaurant would you like to order from?',
  restaurantPickerButton: () => 'See restaurants',
  restaurantPickerFooter: () => 'Tap a name to open its menu',
  switchConfirmed: () => '🔄 Switching restaurants. Your basket has been cleared.',

  orderConfirmedWithChoice: (shortId, name, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const contactBlock = contactLines ? `\n\n${name}\n${contactLines}` : '';
    return `✅ Order received! Order #${shortId}${contactBlock}\n\nOrder again from ${name}?`;
  },
  orderCancelledWithChoice: (name) => `❌ Order cancelled.\n\nOrder again from ${name}?`,
  orderAgainPrompt: (name) => `Ordering from ${name}?\n\nContinue here or choose a different restaurant.`,
  orderAgainBtn: () => 'Order here again',
  chooseRestaurantBtn: () => 'Choose restaurant',

  restaurantClosed: (name, firstOrderTime, lastOrderTime) =>
    firstOrderTime && lastOrderTime
      ? `🔒 ${name} is currently closed.\n\nOrders accepted ${firstOrderTime} – ${lastOrderTime}. See you then! 🙏`
      : `🔒 ${name} is currently closed. Please try again later! 🙏`,
  closedLabel: () => '🔒 Closed',

  ordersClosedByOwner: (name) => `⏸️ ${name} is not accepting orders right now. Please try again later! 🙏`,
  deliveryClosedByOwner: () => '🚫 Delivery is currently unavailable. Please choose pickup.',
};
