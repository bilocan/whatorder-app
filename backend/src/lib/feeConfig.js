const { configRef } = require('./collections');

const DEFAULT = { feeType: 'fixed', feeValue: 0.5 };

async function getFeeConfig() {
  const snap = await configRef().get();
  if (!snap.exists) return { ...DEFAULT };
  const data = snap.data();
  return {
    feeType: data.feeType === 'percent' ? 'percent' : 'fixed',
    feeValue: Number(data.feeValue) || DEFAULT.feeValue,
  };
}

/** @param {number} orderTotalEuros gross order total in EUR */
function calcFeeEuros(orderTotalEuros, config) {
  if (config.feeType === 'fixed') return config.feeValue;
  return (orderTotalEuros * config.feeValue) / 100;
}

/** @param {number} grossAmountCents */
function calcFeeCents(grossAmountCents, config) {
  const euros = grossAmountCents / 100;
  return Math.round(calcFeeEuros(euros, config) * 100);
}

module.exports = { getFeeConfig, calcFeeEuros, calcFeeCents, DEFAULT };
