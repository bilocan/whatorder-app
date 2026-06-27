const { settlementConfigRef } = require('./collections');
const { computeNextPayoutBatchAt } = require('./payoutBatchTime');

const DEFAULT = {
  holdDays: 7,
  payoutWeekday: 2,
  payoutTime: '10:00',
  timezone: 'Europe/Vienna',
  /** Pilot/mock default 0 — set 2500 in config/settlement before live. */
  minimumPayoutCents: 0,
  connectMode: 'mock',
  /** Mock Connect: skip 7-day hold so dev can test payout UI without waiting. */
  mockIgnoreHold: true,
};

async function getSettlementConfig() {
  const snap = await settlementConfigRef().get();
  if (!snap.exists) return { ...DEFAULT };
  const data = snap.data();
  const connectMode = data.connectMode === 'live' ? 'live' : 'mock';
  return {
    holdDays: Number(data.holdDays) || DEFAULT.holdDays,
    payoutWeekday: Number.isInteger(data.payoutWeekday) ? data.payoutWeekday : DEFAULT.payoutWeekday,
    payoutTime: typeof data.payoutTime === 'string' ? data.payoutTime : DEFAULT.payoutTime,
    timezone: typeof data.timezone === 'string' ? data.timezone : DEFAULT.timezone,
    minimumPayoutCents: Number.isFinite(Number(data.minimumPayoutCents))
      ? Number(data.minimumPayoutCents)
      : DEFAULT.minimumPayoutCents,
    connectMode,
    mockIgnoreHold: connectMode === 'mock'
      ? data.mockIgnoreHold !== false
      : false,
  };
}

function computeHoldEndsAt(fromDate, config) {
  const holdDays = config?.holdDays ?? DEFAULT.holdDays;
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  return new Date(base.getTime() + holdDays * 86400000);
}

function computeExpectedPayoutAt(holdEndsAt, config) {
  return computeNextPayoutBatchAt(holdEndsAt, config);
}

function resolveConnectMode(config) {
  const envMode = process.env.PAYOUT_CONNECT_MODE;
  if (envMode === 'live' || envMode === 'mock') return envMode;
  return config.connectMode === 'live' ? 'live' : 'mock';
}

module.exports = {
  getSettlementConfig,
  computeHoldEndsAt,
  computeExpectedPayoutAt,
  computeNextPayoutBatchAt,
  resolveConnectMode,
  DEFAULT,
};
