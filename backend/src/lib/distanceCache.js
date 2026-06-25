// In-memory cache for driving distance lookups — keyed by customer origin + business id.
// TTL matches session idle timeout (8h) per pilot Maps decision.
const TTL_MS = 8 * 60 * 60 * 1000;
const cache = new Map();

function cacheKey(customerLat, customerLng, businessId) {
  return `${customerLat.toFixed(4)},${customerLng.toFixed(4)}:${businessId}`;
}

function get(customerLat, customerLng, businessId) {
  const key = cacheKey(customerLat, customerLng, businessId);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { distanceKm: entry.distanceKm, durationMin: entry.durationMin };
}

function set(customerLat, customerLng, businessId, distanceKm, durationMin) {
  const key = cacheKey(customerLat, customerLng, businessId);
  cache.set(key, { distanceKm, durationMin, expiresAt: Date.now() + TTL_MS });
}

function clear() {
  cache.clear();
}

module.exports = { get, set, clear, TTL_MS };
