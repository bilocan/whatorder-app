const SETUP_STRIP_KEYS = [
  'paymentEnabled',
  'stripeConnectAccountId',
  'stripeConnectOnboardingComplete',
  'catalogId',
];

function isSameEnv(source, target) {
  if (!source || !target) return false;
  return source.firebaseProject === target.firebaseProject
    && source.firestoreDatabase === target.firestoreDatabase
    && source.stripeMode === target.stripeMode;
}

function stripStripeKeys(business) {
  const next = { ...business };
  for (const key of Object.keys(next)) {
    if (key === 'stripeConnectAccountId'
      || key === 'stripeConnectOnboardingComplete'
      || key.startsWith('stripe')) {
      delete next[key];
    }
  }
  next.paymentEnabled = false;
  return next;
}

function freezePresence(business) {
  const next = { ...business };
  delete next.isOnline;
  delete next.lastSeenAt;
  delete next.presenceSessions;
  next.ordersOpen = false;
  next.deliveryOpen = false;
  return next;
}

/**
 * Sanitize a business doc for import.
 * Setup always strips Stripe/catalog. Full keeps them only on same-env restore.
 */
function sanitizeBusinessDoc(business, { profile, source, target } = {}) {
  if (!business || typeof business !== 'object') return business;
  let next = freezePresence(business);
  const keepConnect = profile === 'full' && isSameEnv(source, target);
  if (!keepConnect) {
    next = stripStripeKeys(next);
    delete next.catalogId;
  }
  return next;
}

function sanitizeOrder(order, { profile, source, target } = {}) {
  if (!order || typeof order !== 'object') return order;
  const keepSettlement = profile === 'full' && isSameEnv(source, target);
  if (keepSettlement) return { ...order };
  const next = { ...order };
  next.settlementStatus = 'none';
  delete next.payoutId;
  delete next.stripeTransferId;
  delete next.stripePaymentIntentId;
  delete next.paymentStripeSessionId;
  return next;
}

module.exports = {
  SETUP_STRIP_KEYS,
  isSameEnv,
  sanitizeBusinessDoc,
  sanitizeOrder,
};
