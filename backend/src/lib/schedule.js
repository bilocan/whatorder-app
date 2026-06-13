const DAY_SHORT = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localDayOfWeek(timezone) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date());
  return DAY_SHORT[label] ?? new Date().getDay();
}

function localHHMM(timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()); // 'HH:MM' — zero-padded, string comparison works
}

// schedule is a map: { "1": { openTime, closeTime, firstOrderTime, lastOrderTime }, ... }
// Absence of a day key means that day is closed.

function isOpenNow(schedule, timezone = 'Europe/Vienna') {
  if (!schedule || !Object.keys(schedule).length) return true; // no schedule configured = always open
  const dayConfig = schedule[String(localDayOfWeek(timezone))];
  if (!dayConfig) return false; // schedule exists but today not in it = closed
  if (!dayConfig.openTime || !dayConfig.closeTime) return true; // day present but no times = open all day
  const time = localHHMM(timezone);
  return time >= dayConfig.openTime && time <= dayConfig.closeTime;
}

function isOrderingOpen(schedule, timezone = 'Europe/Vienna') {
  if (!schedule || !Object.keys(schedule).length) return true;
  const dayConfig = schedule[String(localDayOfWeek(timezone))];
  if (!dayConfig) return false;
  if (!dayConfig.firstOrderTime || !dayConfig.lastOrderTime) return true;
  const time = localHHMM(timezone);
  return time >= dayConfig.firstOrderTime && time <= dayConfig.lastOrderTime;
}

// Returns { firstOrderTime, lastOrderTime } for today's day config, or null if closed today.
function getTodayOrderWindow(schedule, timezone = 'Europe/Vienna') {
  if (!schedule) return null;
  const dayConfig = schedule[String(localDayOfWeek(timezone))];
  if (!dayConfig) return null;
  return { firstOrderTime: dayConfig.firstOrderTime, lastOrderTime: dayConfig.lastOrderTime };
}

module.exports = { isOpenNow, isOrderingOpen, getTodayOrderWindow };
