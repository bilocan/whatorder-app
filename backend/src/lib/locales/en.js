module.exports = {
  categories: { mains: 'Mains', sides: 'Sides', drinks: 'Drinks' },

  greeting: (name) => `👋 Welcome to ${name}!\n\nOpen the menu below.`,
  langChanged: () => '✅ Language changed to English.',

  menuListHeader: (name) => `🍽️ ${name}`,
  menuListBody: () => 'What would you like to order?\nTap an item to select.',
  menuListFooter: () => 'Tap to select',
  viewMenuBtn: () => 'View Menu',
  menuCategoryBody: () => 'Choose a category to browse the menu. A numbered text list follows each category.',
  menuCategoriesSection: () => 'Categories',
  menuCategoryCount: (count) => `${count} item${count !== 1 ? 's' : ''}`,
  menuBackCategories: () => '← All categories',
  menuNextPage: () => 'More items →',
  menuPrevPage: () => '← Previous',
  menuMoreItemsDesc: (count) => `${count} more item${count !== 1 ? 's' : ''}`,
  menuHeader: () => '📋 Menu',
  menuExample: () => 'Or type item names, e.g. "2x döner, 1 ayran".',
  textMenuCategoryHeader: (category) => `📋 ${category}`,
  textMenuSelectHint: () => 'Reply with item numbers: 1, 3 or 2x1 for 2× item 1.',
  textMenuInvalid: (items) => `Could not find: ${items}. Check the numbers and try again.`,
  textMenuPickCategory: () => 'Pick a category from the menu first, then reply with item numbers.',
  textMenuContinued: (category, part) => `📋 ${category} (continued ${part})`,
  textMenuContinuedHint: () => 'More items in the next message…',

  qtyBody: (name, price) => `${name} — €${price}\n\nHow many?`,

  itemAdded: (qty, name, count, total) => `✅ ${qty}× ${name} added.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  itemsAdded: (addedQty, count, total) => `✅ ${addedQty} item${addedQty !== 1 ? 's' : ''} added.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  itemRemoved: (name, count, total) => `✅ ${name} removed.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  itemsRemoved: (removedQty, count, total) => `✅ ${removedQty} item${removedQty !== 1 ? 's' : ''} removed.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  qtyUpdated: (name, qty, count, total) => `✅ ${name} → ${qty}×\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  basketMutated: (count, total) => `✅ Basket updated.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  basketUndone: (count, total) => `✅ Undone.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  basketNothingToUndo: () => 'Nothing to undo.',
  reorderLoaded: (count, total) => `✅ Same order loaded.\n🛒 ${count} item${count !== 1 ? 's' : ''} · €${total}`,
  addMoreBtn: () => 'Add more',
  viewBasketBtn: () => 'View basket',
  doneBtn: () => 'Done',

  basketHeader: () => '🛒 Your order:',
  basketEmpty: () => 'Your basket is empty. Select an item from the menu.',
  clearBasketBtn: () => 'Clear basket',
  removeItemBtn: () => 'Remove',
  basketRemoveHint: () =>
    'What should I remove?\n\nExamples:\n• 1 or 1, 3, 4\n• without ayran\n• remove döner and cola\n\nCancel: cancel · Clear all: all',
  basketRemoveNotFound: (text) => `Could not match "${text}". Try a line number or item name.`,
  basketRemoveAmbiguous: (linesText, count) => {
    const hint = count === 2
      ? 'Reply: 1, 2, both, or all'
      : 'Reply with a line number or all';
    return `Multiple matches — which line should I remove?\n\n${linesText}\n\n${hint}`;
  },
  basketRemoveDisambigNotFound: () => 'I did not understand that. Reply with a line number from the list.',
  confirmBtn: () => 'Confirm',

  orderTotal: (total) => `Total: €${total}`,
  confirmSummary: (basketText, prepMins, pickupTime) => `${basketText}\n⏱️ Ready in ~${prepMins} min (around ${pickupTime})\n\nWhat's your name for the order?`,
  finalConfirmBody: (name, total, pickupTime, deliveryAddress, notes, paymentMethod) => {
    const detail = deliveryAddress
      ? `🚚 Delivery to: ${deliveryAddress}`
      : `⏱️ Ready around ${pickupTime}`;
    const notesLine = notes ? `\n📝 Note: ${notes}` : '';
    const paymentLine = paymentMethod === 'stripe' ? '\n💳 Payment: Card' : '';
    return `✅ Almost done!\n\n👤 ${name}\n💶 Total: €${total}\n${detail}${paymentLine}${notesLine}\n\nTap below to confirm or edit.`;
  },
  confirmListHeader: () => 'Review order',
  confirmListBtn: () => 'Confirm or edit',
  confirmListSection: () => 'Options',
  confirmEditNameBtn: () => 'Change name',
  confirmEditAddressBtn: () => 'Change address',
  confirmEditOrderTypeBtn: () => 'Pickup/delivery',
  confirmOrderTypePickup: () => 'Pickup',
  confirmOrderTypeDelivery: () => 'Delivery',
  confirmNoAddressYet: () => 'No address yet',
  askNameEdit: (current) => `Current name: ${current}\n\nType your updated name:`,
  askOrderTypeFromConfirm: () => 'Choose pickup or delivery for this order:',
  confirmOrderBtn: () => 'Confirm ✅',
  addNoteBtn: () => 'Add note 📝',
  backToCartBtn: () => 'Back to cart 🛒',
  addNotePrompt: () => 'Type your special request, allergy, or note.',
  confirmPrompt: () => 'Type YES to confirm, NO to cancel.',
  yesNoOnly: () => 'Please type YES or NO.',
  orderConfirmed: (shortId) => `✅ Order received! Order #${shortId}\n\nWe'll notify you when it's ready. Thank you! 🙏`,
  orderReceipt: (shortId, restaurantName, itemLines, total, pickupTime, customerName, deliveryAddress, paymentMethod, alertPhone, address) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const restaurantBlock = contactLines ? `${restaurantName}\n${contactLines}` : restaurantName;
    const detail = deliveryAddress ? `Delivery to: ${deliveryAddress}` : `Ready by: ${pickupTime}`;
    return `✅ Order #${shortId}\n\n${restaurantBlock}\n\n${itemLines}\n\nTotal: €${total}\n${detail}\n\nThanks, ${customerName}! 🙏`;
  },
  checkoutCancelled: () => 'Order cancelled.',
  cancelOrderBtn: () => 'Cancel',
  checkoutNameNotOrder: () => 'That sounds like an order, not a name. What name should we put on the order?',
  checkoutDigitClarify: () => 'Did you mean a line number from your basket? Type item names or use the confirm button.',
  checkoutBasketUpdated: (basketText) => `✅ Basket updated.\n\n${basketText}`,
  checkoutAddressNotOrder: () => 'That sounds like an order. Please enter your delivery address, or add items via the basket first.',
  payNowBtn: () => 'Pay now 💳',
  paymentLink: (shortId, itemLines, total, restaurantName, alertPhone, address, deliveryAddress) => {
    const contactLines = [alertPhone ? `📞 ${alertPhone}` : null, address ? `📍 ${address}` : null].filter(Boolean).join('\n');
    const restaurantBlock = contactLines ? `${restaurantName}\n${contactLines}` : restaurantName;
    const detail = deliveryAddress ? `Delivery to: ${deliveryAddress}` : null;
    return `Order #${shortId} placed.\n\n${restaurantBlock}\n\n${itemLines}\n\nTotal: €${total}${detail ? `\n${detail}` : ''}\n\nTap the button below to pay securely.`;
  },
  paymentLinkFailed: (shortId) => `Order #${shortId} was created but the payment link failed. Please contact the restaurant or try again.`,
  paymentConfirmed: (shortId) => `✅ Payment received for order #${shortId}. We'll notify you when it's ready. Thank you! 🙏`,
  paymentReturnSuccessTitle: () => 'Payment received',
  paymentReturnCancelTitle: () => 'Payment cancelled',
  paymentReturnSuccessNoLink: () => 'You can close this page and return to WhatsApp.',
  paymentReturnCancelNoLink: () => 'Return to WhatsApp to retry your payment.',
  paymentReturnRedirecting: () => 'Returning to WhatsApp…',
  paymentReturnButton: () => 'Return to WhatsApp',
  paymentReturnFallbackLink: () => 'Tap here if the button does not work.',
  paymentReturnCloseHint: () => 'You can close this tab after returning.',

  menuEmpty: () => 'No items available right now.',

  catalogBody: (name) => `👋 Welcome to ${name}!\n\nBrowse the menu and tap "Add to Cart" on items you'd like to order. When you're done, send your cart.`,
  catalogUnavailable: () => 'Our catalog is not set up yet. Please contact us directly to order.',

  askName: () => "What's your name for the order?",

  orderApproved:  (shortId, etaTime) => `✅ Order #${shortId} accepted! Ready around ${etaTime}.`,
  orderPreparing: (shortId) => `👨‍🍳 Order #${shortId} is now being prepared!`,
  orderReady:     (shortId) => `✅ Your order #${shortId} is ready for pickup! See you soon 🙏`,
  orderOnTheWay:  (shortId) => `🚚 Order #${shortId} is on its way!`,
  orderPickedUp:  (shortId) => `✅ Thanks for picking up order #${shortId}. Enjoy your meal! 🙏`,
  orderDelivered: (shortId) => `✅ Order #${shortId} delivered. Enjoy your meal! 🙏`,
  orderRejected:  (shortId) => `❌ Sorry, order #${shortId} could not be accepted. Please contact us.`,
  orderCancelled: (shortId) => `❌ Order #${shortId} has been cancelled.`,
  orderStatusPending: (shortId) => `⏳ Order #${shortId} was received and is waiting for the restaurant to confirm.`,
  postOrderCallRestaurant: (name, phone) => phone
    ? `To change your order, please call ${name}: ${phone}`
    : `To change your order, please contact ${name} directly.`,
  postOrderCancelled: (shortId) => `✅ Order #${shortId} has been cancelled.`,
  postOrderAmended: (shortId, itemLines, total) => `✅ Order #${shortId} updated.\n\n${itemLines}\n\nNew total: €${total}`,
  humanHandoffOffer: () => 'I am having trouble understanding. Would you like the restaurant to reply to you?',
  humanHandoffBtn: () => 'Get help',
  humanHandoffConfirmed: () => 'Got it. The restaurant has been notified and will get back to you.',
  postOrderOptions: (name) => name ? `🏪 ${name}\nWhat would you like to do?` : 'What would you like to do?',
  postCancelBtn: () => 'Cancel order',
  postReorderBtn: () => 'Reorder',
  postRestaurantBtn: () => 'Choose restaurant',
  postOrderCancelTooLate: (name, phone) => phone
    ? `Your order is already being prepared. To make changes, please call ${name}: ${phone}`
    : `Your order is already being prepared. Please contact ${name} directly.`,

  askOrderType: (fee) => `How would you like to receive your order?\n\nDelivery fee: €${Number(fee).toFixed(2)}`,
  pickupBtn: () => 'Pickup',
  deliveryBtn: () => 'Delivery',
  askDeliveryAddress: () => '📍 Share your location or type your delivery address.\n\nTip: street + house number + PLZ (e.g. Beispielgasse 12, 1010 or Beispielgasse 12/3 1010).',
  askDeliveryAddressShare: () => '📍 Please share your delivery location.',
  deliveryAddressConfirm: (address) => `📍 We found:\n*${address}*\n\nIs this correct?`,
  deliveryAddressConfirmYes: () => 'Yes',
  deliveryAddressConfirmEdit: () => 'Edit',
  deliveryAddressInvalid: () => "We couldn't verify that address. Please type it again or share your location.",
  deliveryAddressGeocodeFailed: () => "We couldn't read an address from that pin. Please type your street and house number.",
  askDeliveryUnit: () => 'Which apartment / entrance?\n\nReply with *Stiege / Tür / Top* (e.g. Top 14 or Stiege 1, Top 8).\nOr reply *Haus* if there is no apartment number.',
  deliveryUnitInvalid: () => "That doesn't look like an apartment. Please reply e.g. *Top 14*, *Stiege 1, Top 8*, or *Haus*.",
  deliveryOutOfZone: () => "Sorry, we don't deliver to that area. Please choose pickup instead.",
  belowMinimumOrderValue: (minValue) => `Sorry, the minimum order value is €${minValue}. Please add more items to your basket.`,

  deliveryAddrPickerHeader: () => '📍 Delivery address',
  deliveryAddrPickerBody:   () => 'Where should we deliver your order?',
  deliveryAddrPickerBtn:    () => 'Choose address',
  deliveryAddrSection:      () => 'Your addresses',
  deliveryLocStart:         () => '📍 Location you shared',
  deliverySavedAddr:        () => '🏠 Your last address',
  deliveryNewAddr:          () => '✏️ Enter new address',
  deliveryShareLoc:         () => '📡 Share location',

  multiWelcomeBody: () => '👋 Welcome to WhatOrder!',
  locationRequestBody: () => '📍 Share your location and we\'ll show the nearest restaurants first.\n\nOr just reply with anything to see all restaurants.',
  restaurantPickerBody: () => 'Which restaurant would you like to order from?',
  restaurantPickerButton: () => 'See restaurants',
  restaurantPickerFooter: () => 'Tap a name to open its menu',
  restaurantPickerFooterNumbered: () => 'Numbers match the map below',
  mapLinkBody: () => '🗺️ Nearby restaurants (numbered). Numbers match the list above.',
  mapLinkBtn: () => 'View on map',
  interactiveMapBody: () => 'Open the interactive map with restaurant names on each pin.',
  interactiveMapBtn: () => 'Open map',
  noNearbyRestaurants: (maxKm) => `No restaurants within ${maxKm} km. Reply *all* to see every restaurant on this number.`,
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

  intentConfirmHeader: () => 'Got it:',
  intentConfirmPrompt: () => 'Add these to your order?',
  intentConfirmBtn: () => 'Add to basket',
  intentChangeBtn: () => 'Change',
  intentEditMenuBtn: () => 'Browse menu',
  intentUnmatched: (items) => `Couldn't find: ${items}`,
  intentUnmatchedWithSuggestion: (name, list) => `We don't have "${name}". Did you mean?\n\n${list}\n\nReply with a number or name.`,
  intentSpecialNote: (note) => `📝 Note: ${note}`,
  intentCustomizePrompt: (itemName, qty, groupLabel) => `${qty}x ${itemName}\nChoose ${groupLabel}:`,
  intentCustomizeUnitPrompt: (unitIndex, unitTotal, itemName, groupLabel) => `${itemName} ${unitIndex}/${unitTotal}\nChoose ${groupLabel}:`,
  intentSameOrEachPrompt: (qty, itemName) => `You ordered ${qty}x ${itemName}.\nSame options for all, or customize each one?`,
  intentSameOptsBtn: () => 'Same for all',
  intentEachOptsBtn: () => 'Customize each',
  intentCustomizeSkip: () => 'Skip',
  intentChooseBtn: () => 'Choose',
  intentMultiPrompt: (qty, itemName, groupLabel, optionList, defaultSummary) =>
    `${qty}x ${itemName}\n${groupLabel} — default: ${defaultSummary}.\nReply with choices (comma-separated), or all / none:\n\n${optionList}\n\nExample: tomato, salad`,
  intentMultiUnitPrompt: (unitIndex, unitTotal, itemName, groupLabel, optionList, defaultSummary) =>
    `${itemName} ${unitIndex}/${unitTotal}\n${groupLabel} — default: ${defaultSummary}.\nReply with choices (comma-separated), or all / none:\n\n${optionList}`,
  intentMultiInvalid: (unmatched, optionList) =>
    `Couldn't match: ${unmatched}\n\nAvailable:\n${optionList}\n\nTry again (comma-separated, all, or none):`,
  intentMultiDefaultAll: () => 'all included',
  intentMultiDefaultNone: () => 'none',
  intentMultiDefaultHint: () => 'Tap Use default, or reply all / none / skip (uses default above).',
  intentMultiDefaultBtn: () => 'Use default',

  reorderPromptHeader: (name) => `👋 Welcome back to ${name}! Your last order:`,
  reorderConfirmPrompt: () => 'Order the same again?',
  reorderConfirmBtn: () => 'Same again ✅',
  reorderBrowseBtn: () => 'Something else',
  reorderUnmatched: (items) => `No longer available: ${items}`,

  orderEntryBody: () =>
    'What would you like?\n\nType your order, e.g. "2x döner, 1 ayran".\nOr tap Popular, Search, or Full menu.',
  popularBtn: () => 'Popular',
  searchBtn: () => 'Search',
  viewFullMenuBtn: () => 'Full menu',
  popularHeader: () => 'Popular',
  popularBody: () => 'Top picks at this restaurant. Tap to add.',
  popularSection: () => 'Popular',
  popularEmpty: () => 'No popular items yet. Try Search or Full menu.',
  searchPromptBody: () => 'What are you looking for?\n\nType 1–2 words, e.g. "pizza" or "cola".',
  searchCancelBtn: () => 'Back',
  searchHeader: () => 'Search',
  searchResultsBody: (query) => `Matches for "${query}":`,
  searchSection: () => 'Results',
  searchNoResults: (query) => `No matches for "${query}". Try another word or tap Search / Full menu.`,
  intentNoMatch: (text) => `Couldn't find "${text}" on the menu. Try Search or Full menu.`,
  intentParseFailed: () => 'Could not understand your order. Try something like "2x döner, 1 ayran" or tap Search.',

  disambigHeader: () => 'Which one?',
  disambigBody: (rawName, qty) => `You said ${qty}x ${rawName}. Which item did you mean?`,
  disambigUnitBody: (rawName, unitIndex, unitTotal) => `${rawName} ${unitIndex}/${unitTotal} — which one?`,
  disambigSameOrEachPrompt: (qty, rawName) =>
    `You ordered ${qty}x ${rawName}.\nSame type for all, or pick each one separately?`,
  disambigSameBtn: () => 'All the same',
  disambigEachBtn: () => 'One by one',
  disambigBtn: () => 'Choose',
  disambigSection: () => 'Matches',

  proposalEditHint: () =>
    'What should I change?\n\nExamples:\n• remove ayran\n• make it 1 döner\n• add 1 cola\n\nOr send a new full order.',
  proposalEditNotFound: (name) => `Couldn't find "${name}" in your order. Try again or tap Add to basket.`,
  proposalEditEmpty: () => 'Your order is empty. What would you like?',
};
