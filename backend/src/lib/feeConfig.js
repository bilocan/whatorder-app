const { configRef } = require('./collections');
const { ymdInTz } = require('./payoutBatchTime');

const DEFAULT = { feeType: 'fixed', feeValue: 0.5 };
const FEE_TZ = 'Europe/Vienna';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isFeeValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizePlatformFee(data) {
  if (!data || typeof data !== 'object' || !isFeeValue(data.feeValue)) return { ...DEFAULT };
  return {
    feeType: data.feeType === 'percent' ? 'percent' : 'fixed',
    feeValue: data.feeValue,
  };
}

function viennaYmd(date) {
  const { year, month, day } = ymdInTz(date, FEE_TZ);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Restaurant `platformFee` wins when it is a valid rate and `until` is missing
 * or still today-or-later in Europe/Vienna. Otherwise the platform fee applies.
 * @param {{ feeType?: string, feeValue?: number }} platform
 * @param {{ feeType?: string, feeValue?: number, until?: string }|null|undefined} override
 * @param {Date} [now]
 */
function resolveEffectiveFee(platform, override, now = new Date()) {
  const base = normalizePlatformFee(platform);
  if (!override || typeof override !== 'object') return base;
  if (override.feeType !== 'percent' && override.feeType !== 'fixed') return base;
  if (!isFeeValue(override.feeValue)) return base;
  if (override.until != null && override.until !== '') {
    if (typeof override.until !== 'string' || !YMD.test(override.until)) return base;
    if (override.until < viennaYmd(now)) return base;
  }
  return { feeType: override.feeType, feeValue: override.feeValue };
}

async function getFeeConfig() {
  const snap = await configRef().get();
  if (!snap.exists) return { ...DEFAULT };
  return normalizePlatformFee(snap.data());
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

module.exports = {
  getFeeConfig,
  calcFeeEuros,
  calcFeeCents,
  resolveEffectiveFee,
  normalizePlatformFee,
  DEFAULT,
};
