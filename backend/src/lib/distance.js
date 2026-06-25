const { isConfigured, fetchDrivingDistances } = require('./googleMaps');
const distanceCache = require('./distanceCache');

const DEFAULT_MAX_RESTAURANT_DISTANCE_KM = 20;

function getMaxRestaurantDistanceKm() {
  const raw = process.env.RESTAURANT_PICKER_MAX_KM;
  if (raw == null || raw === '') return DEFAULT_MAX_RESTAURANT_DISTANCE_KM;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RESTAURANT_DISTANCE_KM;
}

function filterWithinDistanceKm(businesses, maxKm = getMaxRestaurantDistanceKm()) {
  return businesses.filter(b => b.distanceKm != null && b.distanceKm <= maxKm);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sortByHaversine(businesses, customerLat, customerLng) {
  return [...businesses]
    .map(b => ({
      ...b,
      distanceKm: (b.lat != null && b.lng != null)
        ? haversineKm(customerLat, customerLng, b.lat, b.lng)
        : null,
      durationMin: null,
    }))
    .sort(compareByDistance);
}

function compareByDistance(a, b) {
  if (a.distanceKm == null && b.distanceKm == null) return 0;
  if (a.distanceKm == null) return 1;
  if (b.distanceKm == null) return -1;
  return a.distanceKm - b.distanceKm;
}

async function enrichWithDrivingDistances(businesses, customerLat, customerLng) {
  const withCoords = businesses.filter(b => b.lat != null && b.lng != null);
  if (!withCoords.length) return sortByHaversine(businesses, customerLat, customerLng);

  const uncached = [];
  const cachedResults = new Map();

  for (const b of withCoords) {
    const hit = distanceCache.get(customerLat, customerLng, b.id);
    if (hit) {
      cachedResults.set(b.id, hit);
    } else {
      uncached.push(b);
    }
  }

  let apiResults = null;
  if (uncached.length && isConfigured()) {
    try {
      apiResults = await fetchDrivingDistances(
        customerLat,
        customerLng,
        uncached.map(b => ({ lat: b.lat, lng: b.lng })),
      );
    } catch {
      apiResults = null;
    }
  }

  if (apiResults) {
    uncached.forEach((b, i) => {
      const result = apiResults[i];
      if (result) {
        distanceCache.set(customerLat, customerLng, b.id, result.distanceKm, result.durationMin);
        cachedResults.set(b.id, result);
      }
    });
  }

  const enriched = businesses.map(b => {
    if (b.lat == null || b.lng == null) {
      return { ...b, distanceKm: null, durationMin: null };
    }
    const driving = cachedResults.get(b.id);
    if (driving) {
      return { ...b, distanceKm: driving.distanceKm, durationMin: driving.durationMin };
    }
    return {
      ...b,
      distanceKm: haversineKm(customerLat, customerLng, b.lat, b.lng),
      durationMin: null,
    };
  });

  return [...enriched].sort(compareByDistance);
}

// Sorts businesses by distance from customerLat/customerLng.
// Attaches distanceKm (and durationMin when Google Maps is available) to each business with coords.
// Businesses without coords are pushed to the end in their original order.
// Falls back to Haversine when GOOGLE_MAPS_API_KEY is unset or the API fails.
async function sortByDistance(businesses, customerLat, customerLng) {
  if (isConfigured()) {
    return enrichWithDrivingDistances(businesses, customerLat, customerLng);
  }
  return sortByHaversine(businesses, customerLat, customerLng);
}

module.exports = {
  haversineKm,
  sortByDistance,
  sortByHaversine,
  getMaxRestaurantDistanceKm,
  filterWithinDistanceKm,
  DEFAULT_MAX_RESTAURANT_DISTANCE_KM,
};
