const STATIC_MAP_BASE = 'https://maps.googleapis.com/maps/api/staticmap';
const DEFAULT_MAX_PINS = 8;

function parseCoord(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function formatCoord(lat, lng) {
  return `${lat},${lng}`;
}

function normalizeBusinessCoords(business) {
  const lat = parseCoord(business.lat);
  const lng = parseCoord(business.lng);
  if (lat == null || lng == null) return null;
  return { ...business, lat, lng };
}

function hasCoords(b) {
  return parseCoord(b.lat) != null && parseCoord(b.lng) != null;
}

function restaurantsWithCoords(businesses, maxPins = DEFAULT_MAX_PINS) {
  return businesses
    .map(normalizeBusinessCoords)
    .filter(Boolean)
    .slice(0, maxPins);
}

function calcMapViewport(points) {
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const span = Math.max(maxLat - minLat, maxLng - minLng);
  let zoom = 14;
  if (span > 0.1) zoom = 12;
  else if (span > 0.05) zoom = 13;
  else if (span < 0.01) zoom = 15;
  return { centerLat, centerLng, zoom };
}

function getPublicBackendUrl() {
  const fromEnv = process.env.BACKEND_URL?.trim();
  if (fromEnv && !fromEnv.includes('localhost')) return fromEnv.replace(/\/$/, '');
  const domain = process.env.NGROK_DOMAIN?.trim();
  if (domain) return `https://${domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  return null;
}

/**
 * Static Maps image with customer (blue U) + numbered restaurant pins. Needs Maps Static API + key.
 */
function buildRestaurantsStaticMapUrl(customerLat, customerLng, businesses, apiKey, { maxPins = DEFAULT_MAX_PINS } = {}) {
  if (!apiKey) return null;
  const clat = parseCoord(customerLat);
  const clng = parseCoord(customerLng);
  if (clat == null || clng == null) return null;

  const withCoords = restaurantsWithCoords(businesses, maxPins);
  if (!withCoords.length) return null;

  const parts = [
    'size=600x400',
    'scale=2',
    `markers=color:blue%7Clabel:U%7C${formatCoord(clat, clng)}`,
    ...withCoords.map((b, i) => `markers=color:red%7Clabel:${i + 1}%7C${formatCoord(b.lat, b.lng)}`),
    `visible=${[formatCoord(clat, clng), ...withCoords.map(b => formatCoord(b.lat, b.lng))].join('%7C')}`,
    `key=${encodeURIComponent(apiKey)}`,
  ];

  return `${STATIC_MAP_BASE}?${parts.join('&')}`;
}

/**
 * Public URL WhatsApp can fetch — proxies Static Maps through our backend (keeps API key server-side).
 */
function buildRestaurantsMapProxyUrl(customerLat, customerLng, businesses, baseUrl, { maxPins = DEFAULT_MAX_PINS } = {}) {
  const clat = parseCoord(customerLat);
  const clng = parseCoord(customerLng);
  if (clat == null || clng == null || !baseUrl) return null;

  const withCoords = restaurantsWithCoords(businesses, maxPins);
  if (!withCoords.length) return null;

  const params = new URLSearchParams({
    clat: String(clat),
    clng: String(clng),
    pins: withCoords.map(b => formatCoord(b.lat, b.lng)).join('|'),
  });

  return `${baseUrl.replace(/\/$/, '')}/api/maps/restaurants-preview?${params.toString()}`;
}

function getPublicMapBaseUrl() {
  const fromEnv = process.env.MAP_PUBLIC_URL?.trim() || process.env.DASHBOARD_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:5173';
  return null;
}

/**
 * Public dashboard /map page — interactive map with named pins (WhatsApp CTA).
 */
function buildPublicRestaurantMapUrl(customerLat, customerLng, businessIds, baseUrl) {
  const clat = parseCoord(customerLat);
  const clng = parseCoord(customerLng);
  if (clat == null || clng == null || !baseUrl || !businessIds?.length) return null;

  const params = new URLSearchParams({
    clat: String(clat),
    clng: String(clng),
    ids: businessIds.join(','),
  });

  return `${baseUrl.replace(/\/$/, '')}/map?${params.toString()}`;
}

function parsePinsParam(pins) {
  if (!pins?.trim()) return [];
  return pins.split('|').map((pair, i) => {
    const [latRaw, lngRaw] = pair.split(',');
    const lat = parseCoord(latRaw);
    const lng = parseCoord(lngRaw);
    if (lat == null || lng == null) return null;
    return { id: `p${i}`, lat, lng };
  }).filter(Boolean);
}

/**
 * Opens Google Maps centered on all points — browse only, no directions/route.
 */
function buildRestaurantsBrowseMapUrl(customerLat, customerLng, businesses, { maxPins = DEFAULT_MAX_PINS } = {}) {
  const clat = parseCoord(customerLat);
  const clng = parseCoord(customerLng);
  if (clat == null || clng == null) return null;

  const withCoords = restaurantsWithCoords(businesses, maxPins);
  if (!withCoords.length) return null;

  const points = [{ lat: clat, lng: clng }, ...withCoords.map(b => ({ lat: b.lat, lng: b.lng }))];
  const { centerLat, centerLng, zoom } = calcMapViewport(points);
  const params = new URLSearchParams({
    api: '1',
    map_action: 'map',
    center: formatCoord(centerLat, centerLng),
    zoom: String(zoom),
  });

  return `https://www.google.com/maps/@?${params.toString()}`;
}

module.exports = {
  parseCoord,
  buildRestaurantsStaticMapUrl,
  buildRestaurantsMapProxyUrl,
  buildRestaurantsBrowseMapUrl,
  buildPublicRestaurantMapUrl,
  parsePinsParam,
  getPublicBackendUrl,
  getPublicMapBaseUrl,
  DEFAULT_MAX_PINS,
};
