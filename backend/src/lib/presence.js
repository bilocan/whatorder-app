/** Grace period after last dashboard heartbeat before treating owner as offline. */
const PRESENCE_TTL_MS = 90_000;

function timestampToMs(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isTimestampFresh(value, ttlMs = PRESENCE_TTL_MS) {
  const ms = timestampToMs(value);
  if (ms == null) return false;
  return Date.now() - ms < ttlMs;
}

/** Any per-tab session heartbeat within TTL counts as online. */
function hasActivePresenceSession(biz, ttlMs = PRESENCE_TTL_MS) {
  const sessions = biz?.presenceSessions;
  if (!sessions || typeof sessions !== 'object') return false;
  return Object.values(sessions).some((ts) => isTimestampFresh(ts, ttlMs));
}

/**
 * Owner dashboard is considered online when isOnline is true, or when a stale
 * offline write lost a race but heartbeat / tab sessions are still fresh.
 */
function isOwnerOnline(biz) {
  if (biz?.isOnline === true) return true;
  if (isTimestampFresh(biz?.lastSeenAt)) return true;
  if (hasActivePresenceSession(biz)) return true;
  if (biz?.isOnline === false) return false;
  return true;
}

/** Manual pause is strict; presence uses heartbeat grace for sporadic offline races. */
function isAcceptingOrders(biz) {
  if (biz?.ordersOpen === false) return false;
  return isOwnerOnline(biz);
}

module.exports = {
  PRESENCE_TTL_MS,
  isTimestampFresh,
  hasActivePresenceSession,
  isOwnerOnline,
  isAcceptingOrders,
};
