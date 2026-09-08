/**
 * Firestore rejects dotted updates (`presenceSessions.{tabId}`) when the parent
 * map is missing. Import freezePresence used to omit the field, so the dashboard
 * heartbeat could never set isOnline after a clone.
 */
export function needsPresenceMapSeed(existingSessions: unknown): boolean {
  return existingSessions == null
    || typeof existingSessions !== 'object'
    || Array.isArray(existingSessions);
}
