const { isOpenNow, isOrderingOpen, getTodayOrderWindow } = require('../schedule');

// schedule is now a day-keyed map: { "1": { openTime, closeTime, firstOrderTime, lastOrderTime }, ... }
// Absence of a key = that day is closed.

const TZ = 'UTC'; // use UTC so localHHMM === UTC time in tests

function makeDayConfig(overrides = {}) {
  return { openTime: '09:00', closeTime: '22:00', firstOrderTime: '09:30', lastOrderTime: '21:30', ...overrides };
}

function allDaysOpen(overrides = {}) {
  const cfg = makeDayConfig(overrides);
  return { '0': cfg, '1': cfg, '2': cfg, '3': cfg, '4': cfg, '5': cfg, '6': cfg };
}

function setNow(isoString) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(isoString));
}

afterEach(() => jest.useRealTimers());

// ── isOpenNow ───────────────────────────────────────────────────────────────

describe('isOpenNow', () => {
  test('returns true when no schedule', () => {
    expect(isOpenNow(null, TZ)).toBe(true);
    expect(isOpenNow(undefined, TZ)).toBe(true);
    expect(isOpenNow({}, TZ)).toBe(true); // empty = no days configured = always open
  });

  test('returns true when inside open window', () => {
    setNow('2024-06-10T12:00:00Z'); // Monday 12:00
    expect(isOpenNow(allDaysOpen(), TZ)).toBe(true);
  });

  test('returns false before openTime', () => {
    setNow('2024-06-10T08:00:00Z'); // Monday 08:00, openTime=09:00
    expect(isOpenNow(allDaysOpen(), TZ)).toBe(false);
  });

  test('returns false after closeTime', () => {
    setNow('2024-06-10T22:30:00Z'); // Monday 22:30, closeTime=22:00
    expect(isOpenNow(allDaysOpen(), TZ)).toBe(false);
  });

  test('returns false when today is not in schedule', () => {
    setNow('2024-06-09T12:00:00Z'); // Sunday = day 0
    const schedule = { '1': makeDayConfig(), '2': makeDayConfig() }; // only Mon+Tue
    expect(isOpenNow(schedule, TZ)).toBe(false);
  });

  test('each day can have its own hours', () => {
    // Sunday open 10:00-18:00
    const schedule = {
      '0': makeDayConfig({ openTime: '10:00', closeTime: '18:00' }),
      '1': makeDayConfig({ openTime: '09:00', closeTime: '22:00' }),
    };
    setNow('2024-06-09T19:00:00Z'); // Sunday 19:00 — after 18:00, should be closed
    expect(isOpenNow(schedule, TZ)).toBe(false);

    setNow('2024-06-10T19:00:00Z'); // Monday 19:00 — within 09-22, should be open
    expect(isOpenNow(schedule, TZ)).toBe(true);
  });

  test('returns true at exactly openTime and closeTime', () => {
    setNow('2024-06-10T09:00:00Z');
    expect(isOpenNow(allDaysOpen({ openTime: '09:00' }), TZ)).toBe(true);
    setNow('2024-06-10T22:00:00Z');
    expect(isOpenNow(allDaysOpen({ closeTime: '22:00' }), TZ)).toBe(true);
  });
});

// ── isOrderingOpen ──────────────────────────────────────────────────────────

describe('isOrderingOpen', () => {
  test('returns true when no schedule', () => {
    expect(isOrderingOpen(null, TZ)).toBe(true);
    expect(isOrderingOpen({}, TZ)).toBe(true);
  });

  test('returns true inside order window', () => {
    setNow('2024-06-10T14:00:00Z'); // Monday 14:00
    expect(isOrderingOpen(allDaysOpen(), TZ)).toBe(true);
  });

  test('returns false before firstOrderTime', () => {
    setNow('2024-06-10T09:00:00Z'); // 09:00, firstOrderTime=09:30
    expect(isOrderingOpen(allDaysOpen(), TZ)).toBe(false);
  });

  test('returns false after lastOrderTime', () => {
    setNow('2024-06-10T21:45:00Z'); // 21:45, lastOrderTime=21:30
    expect(isOrderingOpen(allDaysOpen(), TZ)).toBe(false);
  });

  test('returns false when today is not in schedule', () => {
    setNow('2024-06-08T14:00:00Z'); // Saturday = day 6
    const schedule = { '1': makeDayConfig(), '2': makeDayConfig() };
    expect(isOrderingOpen(schedule, TZ)).toBe(false);
  });

  test('per-day order window respected', () => {
    const schedule = {
      '6': makeDayConfig({ firstOrderTime: '10:00', lastOrderTime: '17:00' }), // Saturday
      '1': makeDayConfig({ firstOrderTime: '09:00', lastOrderTime: '21:30' }), // Monday
    };
    setNow('2024-06-08T18:00:00Z'); // Saturday 18:00 — after Sat lastOrderTime=17:00
    expect(isOrderingOpen(schedule, TZ)).toBe(false);

    setNow('2024-06-10T18:00:00Z'); // Monday 18:00 — within Mon window
    expect(isOrderingOpen(schedule, TZ)).toBe(true);
  });

  test('returns true at exactly firstOrderTime and lastOrderTime', () => {
    setNow('2024-06-10T09:30:00Z');
    expect(isOrderingOpen(allDaysOpen({ firstOrderTime: '09:30' }), TZ)).toBe(true);
    setNow('2024-06-10T21:30:00Z');
    expect(isOrderingOpen(allDaysOpen({ lastOrderTime: '21:30' }), TZ)).toBe(true);
  });

  describe('cross-midnight window (firstOrderTime="09:00", lastOrderTime="02:30")', () => {
    const crossMidnight = allDaysOpen({ firstOrderTime: '09:00', lastOrderTime: '02:30' });

    test('open at 14:00 (evening side)', () => {
      setNow('2024-06-10T14:00:00Z'); // Monday 14:00
      expect(isOrderingOpen(crossMidnight, TZ)).toBe(true);
    });

    test('open at 23:59 (just before midnight)', () => {
      setNow('2024-06-10T23:59:00Z');
      expect(isOrderingOpen(crossMidnight, TZ)).toBe(true);
    });

    test('open at 01:00 (early morning of next day)', () => {
      setNow('2024-06-11T01:00:00Z'); // Tuesday 01:00 — within Monday lastOrderTime 02:30
      expect(isOrderingOpen(crossMidnight, TZ)).toBe(true);
    });

    test('open at exactly lastOrderTime 02:30', () => {
      setNow('2024-06-11T02:30:00Z');
      expect(isOrderingOpen(crossMidnight, TZ)).toBe(true);
    });

    test('closed at 03:00 (after lastOrderTime on next day)', () => {
      setNow('2024-06-11T03:00:00Z'); // Tuesday 03:00 — past Monday lastOrderTime
      expect(isOrderingOpen(crossMidnight, TZ)).toBe(false);
    });

    test('closed before firstOrderTime (08:00)', () => {
      setNow('2024-06-10T08:00:00Z');
      expect(isOrderingOpen(crossMidnight, TZ)).toBe(false);
    });
  });
});

// ── getTodayOrderWindow ─────────────────────────────────────────────────────

describe('getTodayOrderWindow', () => {
  test('returns null when no schedule', () => {
    expect(getTodayOrderWindow(null, TZ)).toBeNull();
    expect(getTodayOrderWindow(undefined, TZ)).toBeNull();
  });

  test('returns null when today is not in schedule (closed day)', () => {
    setNow('2024-06-09T12:00:00Z'); // Sunday = day 0
    const schedule = { '1': makeDayConfig() }; // only Monday
    expect(getTodayOrderWindow(schedule, TZ)).toBeNull();
  });

  test('returns firstOrderTime and lastOrderTime for today', () => {
    setNow('2024-06-10T12:00:00Z'); // Monday = day 1
    const schedule = { '1': makeDayConfig({ firstOrderTime: '10:00', lastOrderTime: '20:00' }) };
    expect(getTodayOrderWindow(schedule, TZ)).toEqual({ firstOrderTime: '10:00', lastOrderTime: '20:00' });
  });

  test('returns the correct day config even when multiple days present', () => {
    setNow('2024-06-08T12:00:00Z'); // Saturday = day 6
    const schedule = {
      '1': makeDayConfig({ firstOrderTime: '09:00', lastOrderTime: '21:30' }),
      '6': makeDayConfig({ firstOrderTime: '10:00', lastOrderTime: '17:00' }),
    };
    expect(getTodayOrderWindow(schedule, TZ)).toEqual({ firstOrderTime: '10:00', lastOrderTime: '17:00' });
  });
});
