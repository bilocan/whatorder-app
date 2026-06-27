const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function getTimezoneOffsetMs(timeZone, date) {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tz = new Date(date.toLocaleString('en-US', { timeZone }));
  return tz.getTime() - utc.getTime();
}

function ymdInTz(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = getTimezoneOffsetMs(timeZone, new Date(utcGuess));
  return new Date(utcGuess - offset);
}

function weekdayInTz(date, timeZone) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return WEEKDAY_MAP[short];
}

/** First weekly batch slot at or after `notBefore` (local weekday + time in config.timezone). */
function computeNextPayoutBatchAt(notBefore, config) {
  const timeZone = config.timezone || 'Europe/Vienna';
  const targetDow = config.payoutWeekday ?? 2;
  const [hour, minute] = (config.payoutTime || '10:00').split(':').map(Number);
  const start = typeof notBefore === 'string' ? new Date(notBefore) : new Date(notBefore.getTime());

  let cursor = new Date(start);
  for (let i = 0; i < 15; i++) {
    const ymd = ymdInTz(cursor, timeZone);
    const candidate = zonedTimeToUtc({ ...ymd, hour, minute }, timeZone);
    if (weekdayInTz(candidate, timeZone) === targetDow && candidate.getTime() >= start.getTime()) {
      return candidate;
    }
    cursor = new Date(cursor.getTime() + 86400000);
  }

  return new Date(start.getTime() + 7 * 86400000);
}

module.exports = {
  computeNextPayoutBatchAt,
  ymdInTz,
  zonedTimeToUtc,
  weekdayInTz,
};
