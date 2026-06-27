const {
  isTimestampFresh,
  hasActivePresenceSession,
  isOwnerOnline,
  isAcceptingOrders,
  PRESENCE_TTL_MS,
} = require('../presence');

function tsAgo(ms) {
  return { toDate: () => new Date(Date.now() - ms) };
}

describe('presence', () => {
  describe('isTimestampFresh', () => {
    it('returns true for recent timestamps', () => {
      expect(isTimestampFresh(tsAgo(30_000))).toBe(true);
    });

    it('returns false when older than TTL', () => {
      expect(isTimestampFresh(tsAgo(PRESENCE_TTL_MS + 1))).toBe(false);
    });

    it('returns false for missing values', () => {
      expect(isTimestampFresh(null)).toBe(false);
      expect(isTimestampFresh(undefined)).toBe(false);
    });
  });

  describe('hasActivePresenceSession', () => {
    it('returns true when any tab session is fresh', () => {
      const biz = {
        presenceSessions: {
          tab_a: tsAgo(PRESENCE_TTL_MS + 5_000),
          tab_b: tsAgo(10_000),
        },
      };
      expect(hasActivePresenceSession(biz)).toBe(true);
    });

    it('returns false when all tab sessions are stale', () => {
      const biz = {
        presenceSessions: { tab_a: tsAgo(PRESENCE_TTL_MS + 1) },
      };
      expect(hasActivePresenceSession(biz)).toBe(false);
    });
  });

  describe('isOwnerOnline', () => {
    it('returns true when isOnline is explicitly true', () => {
      expect(isOwnerOnline({ isOnline: true })).toBe(true);
    });

    it('returns true when isOnline is false but lastSeenAt is fresh', () => {
      expect(isOwnerOnline({ isOnline: false, lastSeenAt: tsAgo(15_000) })).toBe(true);
    });

    it('returns true when isOnline is false but a tab session is fresh', () => {
      expect(isOwnerOnline({
        isOnline: false,
        lastSeenAt: tsAgo(PRESENCE_TTL_MS + 1),
        presenceSessions: { tab_1: tsAgo(5_000) },
      })).toBe(true);
    });

    it('returns false when isOnline is false and presence is stale', () => {
      expect(isOwnerOnline({
        isOnline: false,
        lastSeenAt: tsAgo(PRESENCE_TTL_MS + 1),
      })).toBe(false);
    });

    it('treats undefined isOnline as open for legacy docs', () => {
      expect(isOwnerOnline({})).toBe(true);
    });
  });

  describe('isAcceptingOrders', () => {
    it('returns false when owner manually paused orders', () => {
      expect(isAcceptingOrders({ ordersOpen: false, isOnline: true })).toBe(false);
    });

    it('returns true when online and orders not paused', () => {
      expect(isAcceptingOrders({ isOnline: true, ordersOpen: true })).toBe(true);
    });

    it('returns true during stale-offline race when heartbeat is fresh', () => {
      expect(isAcceptingOrders({
        isOnline: false,
        ordersOpen: true,
        lastSeenAt: tsAgo(20_000),
      })).toBe(true);
    });
  });
});
