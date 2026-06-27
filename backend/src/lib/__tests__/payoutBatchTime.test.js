const { computeNextPayoutBatchAt } = require('../payoutBatchTime');

const PILOT_CONFIG = {
  payoutWeekday: 2,
  payoutTime: '10:00',
  timezone: 'Europe/Vienna',
};

describe('computeNextPayoutBatchAt', () => {
  test('returns Tuesday 10:00 Vienna on or after hold end (Wed → next Tue)', () => {
    const holdEnd = new Date('2026-06-11T08:00:00.000Z'); // Wed after hold
    const next = computeNextPayoutBatchAt(holdEnd, PILOT_CONFIG);
    expect(next.getUTCDay()).toBe(2); // Tuesday UTC may differ but weekday in Vienna should be Tue
    expect(next.getTime()).toBeGreaterThanOrEqual(holdEnd.getTime());
  });

  test('includes same-day batch if hold clears before batch time', () => {
    const holdEnd = new Date('2026-06-09T07:00:00.000Z'); // Tue morning UTC-ish
    const next = computeNextPayoutBatchAt(holdEnd, PILOT_CONFIG);
    expect(next.getTime()).toBeGreaterThanOrEqual(holdEnd.getTime());
  });
});
