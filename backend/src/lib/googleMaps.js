const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const REQUEST_TIMEOUT_MS = 4000;
const MAX_DESTINATIONS_PER_REQUEST = 25;

function getApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

/** Client-side Maps JavaScript API key (whatorder.at/map). Falls back to server key in pilot. */
function getMapsJsApiKey() {
  const jsKey = process.env.GOOGLE_MAPS_JS_API_KEY?.trim();
  if (jsKey) return jsKey;
  return getApiKey();
}

function isConfigured() {
  return Boolean(getApiKey());
}

async function fetchJson(url, params) {
  const qs = new URLSearchParams({ ...params, key: getApiKey() });
  const res = await fetch(`${url}?${qs}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) return null;
  return res.json();
}

function parseDrivingElement(element) {
  if (element?.status !== 'OK') return null;
  const distanceKm = element.distance?.value != null ? element.distance.value / 1000 : null;
  const durationMin = element.duration?.value != null ? Math.round(element.duration.value / 60) : null;
  if (distanceKm == null) return null;
  return { distanceKm, durationMin };
}

async function fetchDrivingDistancesBatch(originLat, originLng, destinations) {
  if (!destinations.length || !isConfigured()) return null;

  const origin = `${originLat},${originLng}`;
  const destStr = destinations.map(d => `${d.lat},${d.lng}`).join('|');
  const data = await fetchJson(DISTANCE_MATRIX_URL, {
    origins: origin,
    destinations: destStr,
    mode: 'driving',
    units: 'metric',
  });

  if (data?.status !== 'OK' || !data.rows?.[0]?.elements) return null;

  return data.rows[0].elements.map(parseDrivingElement);
}

// Returns array parallel to destinations: { distanceKm, durationMin } | null per entry.
async function fetchDrivingDistances(originLat, originLng, destinations) {
  if (!destinations.length) return [];
  if (!isConfigured()) return null;

  const results = [];
  for (let i = 0; i < destinations.length; i += MAX_DESTINATIONS_PER_REQUEST) {
    const chunk = destinations.slice(i, i + MAX_DESTINATIONS_PER_REQUEST);
    const chunkResults = await fetchDrivingDistancesBatch(originLat, originLng, chunk);
    if (!chunkResults) return null;
    results.push(...chunkResults);
  }
  return results;
}

async function geocodeForward(address) {
  if (!isConfigured() || !address?.trim()) return null;
  const data = await fetchJson(GEOCODE_URL, { address: address.trim() });
  if (data?.status !== 'OK' || !data.results?.length) return null;
  const loc = data.results[0].geometry?.location;
  if (loc?.lat == null || loc?.lng == null) return null;
  return { lat: loc.lat, lng: loc.lng };
}

async function geocodeReverse(lat, lng) {
  if (!isConfigured()) return null;
  const data = await fetchJson(GEOCODE_URL, { latlng: `${lat},${lng}` });
  if (data?.status !== 'OK' || !data.results?.length) return null;
  return data.results[0].formatted_address ?? null;
}

module.exports = {
  getApiKey,
  getMapsJsApiKey,
  isConfigured,
  fetchDrivingDistances,
  geocodeForward,
  geocodeReverse,
  MAX_DESTINATIONS_PER_REQUEST,
};
