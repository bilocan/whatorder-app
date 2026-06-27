const { getStripe } = require('./stripe');
const { resolveConnectMode } = require('./settlementConfig');

async function executeConnectTransfer({ businessId, business, amountCents, config, payoutId }) {
  const mode = resolveConnectMode(config);
  const connectAccountId = business?.stripeConnectAccountId ?? null;

  if (mode === 'mock') {
    return {
      mode: 'mock',
      transferId: `mock_tr_${payoutId}`,
      connectAccountId: connectAccountId || `mock_acct_${businessId}`,
    };
  }

  if (!connectAccountId || !business?.stripeConnectOnboardingComplete) {
    const err = new Error(`Stripe Connect not ready for ${businessId}`);
    err.code = 'CONNECT_NOT_READY';
    err.businessId = businessId;
    throw err;
  }

  const stripe = getStripe();
  if (!stripe) {
    const err = new Error('Stripe is not configured');
    err.code = 'STRIPE_NOT_CONFIGURED';
    throw err;
  }

  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: 'eur',
    destination: connectAccountId,
    metadata: { business_id: businessId, payout_id: payoutId },
  });

  return {
    mode: 'live',
    transferId: transfer.id,
    connectAccountId,
  };
}

module.exports = { executeConnectTransfer };
