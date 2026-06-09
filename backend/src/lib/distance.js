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

// Sorts businesses by distance from customerLat/customerLng.
// Attaches distanceKm to each business that has coords (null otherwise).
// Businesses without coords are pushed to the end in their original order.
function sortByDistance(businesses, customerLat, customerLng) {
  return [...businesses]
    .map(b => ({
      ...b,
      distanceKm: (b.lat != null && b.lng != null)
        ? haversineKm(customerLat, customerLng, b.lat, b.lng)
        : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });
}

module.exports = { haversineKm, sortByDistance };
