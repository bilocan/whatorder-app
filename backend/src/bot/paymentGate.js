const { isStripeConfigured } = require('../lib/stripe');
const { isLegalComplete, isSettlementIbanComplete } = require('../lib/legalProfile');

// Card payments require Beleg seller data + settlement IBAN (defense in depth vs Settings UI gate).
// Single source of truth: the confirm screens must advertise card payment only when
// `placeOrderAndNotify` would actually take the Stripe branch.
function isPaymentEnabled(info = {}) {
  return info.paymentEnabled === true
    && isStripeConfigured()
    && isLegalComplete(info.legal)
    && isSettlementIbanComplete(info.legal);
}

module.exports = { isPaymentEnabled };
