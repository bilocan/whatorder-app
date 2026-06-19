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
  const time = localHHMM(timezone);
  const dow = localDayOfWeek(timezone);

  const todayConfig = schedule[String(dow)];
  if (todayConfig) {
    if (!todayConfig.openTime || !todayConfig.closeTime) return true; // day present but no times = open all day
    const { openTime, closeTime } = todayConfig;
    if (closeTime >= openTime) {
      if (time >= openTime && time <= closeTime) return true;
    } else {
      // Cross-midnight window — evening side (e.g. 09:00 → next day 02:00)
      if (time >= openTime) return true;
    }
  }

  // Check if yesterday's cross-midnight window still covers this early morning hour
  const prevDow = (dow + 6) % 7;
  const prevConfig = schedule[String(prevDow)];
  if (prevConfig?.openTime && prevConfig?.closeTime) {
    const { openTime, closeTime } = prevConfig;
    if (closeTime < openTime && time <= closeTime) return true;
  }

  return false;
}

function isOrderingOpen(schedule, timezone = 'Europe/Vienna') {
  if (!schedule || !Object.keys(schedule).length) return true;
  const time = localHHMM(timezone);
  const dow = localDayOfWeek(timezone);

  const todayConfig = schedule[String(dow)];
  if (todayConfig) {
    if (!todayConfig.firstOrderTime || !todayConfig.lastOrderTime) return true;
    const { firstOrderTime: fo, lastOrderTime: lo } = todayConfig;
    if (lo >= fo) {
      if (time >= fo && time <= lo) return true;
    } else {
      // Cross-midnight window — evening side
      if (time >= fo) return true;
    }
  }

  // Check if yesterday's cross-midnight window still covers this early morning hour
  const prevDow = (dow + 6) % 7;
  const prevConfig = schedule[String(prevDow)];
  if (prevConfig?.firstOrderTime && prevConfig?.lastOrderTime) {
    const { firstOrderTime: fo, lastOrderTime: lo } = prevConfig;
    if (lo < fo && time <= lo) return true;
  }

  return false;
}

// Returns { firstOrderTime, lastOrderTime } for today's day config, or null if closed today.
function getTodayOrderWindow(schedule, timezone = 'Europe/Vienna') {
  if (!schedule) return null;
  const dayConfig = schedule[String(localDayOfWeek(timezone))];
  if (!dayConfig) return null;
  return { firstOrderTime: dayConfig.firstOrderTime, lastOrderTime: dayConfig.lastOrderTime };
}

module.exports = { isOpenNow, isOrderingOpen, getTodayOrderWindow };
