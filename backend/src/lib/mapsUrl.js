const DEFAULT_MAX_PINS = 8;
/** Production customer map — whatorder.at (not owner dashboard). */
const DEFAULT_MAP_PUBLIC_URL = 'https://whatorder.at';
/** Local whatorderat `npm run dev` (port 3000; stop backend or use another port if both needed). */
const DEFAULT_DEV_MAP_PUBLIC_URL = 'http://localhost:3000';
const MAP_PAGE_LANGS = new Set(['de', 'en', 'tr']);

function normalizeMapLang(lang) {
  const code = String(lang ?? '').trim().toLowerCase().slice(0, 2);
  return MAP_PAGE_LANGS.has(code) ? code : null;
}

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

function getPublicMapBaseUrl() {
  const fromEnv = process.env.MAP_PUBLIC_URL?.trim() || process.env.DASHBOARD_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return DEFAULT_MAP_PUBLIC_URL;
  return DEFAULT_DEV_MAP_PUBLIC_URL;
}

/** @deprecated Alias for getPublicMapBaseUrl */
function getExplicitMapBaseUrl() {
  return getPublicMapBaseUrl();
}

/**
 * WhatsApp "Open map" CTA after the numbered restaurant list.
 * WhatOrder /map (numbered + named pins). Google Maps browse is fallback only — no multi-pin support.
 */
function buildOpenMapCtaUrl(customerLat, customerLng, businesses, businessIds, lang) {
  const clat = parseCoord(customerLat);
  const clng = parseCoord(customerLng);
  if (clat == null || clng == null) return null;

  const dashboardBase = getPublicMapBaseUrl();
  if (dashboardBase && businessIds?.length) {
    const mapUrl = buildPublicRestaurantMapUrl(clat, clng, businessIds, dashboardBase, lang);
    if (mapUrl) return mapUrl;
  }
  return buildRestaurantsBrowseMapUrl(clat, clng, businesses);
}

/**
 * Public customer map on whatorder.at — interactive map with named pins (WhatsApp CTA).
 */
function buildPublicRestaurantMapUrl(customerLat, customerLng, businessIds, baseUrl, lang) {
  const clat = parseCoord(customerLat);
  const clng = parseCoord(customerLng);
  if (clat == null || clng == null || !baseUrl || !businessIds?.length) return null;

  const params = new URLSearchParams({
    clat: String(clat),
    clng: String(clng),
    ids: businessIds.join(','),
  });
  const mapLang = normalizeMapLang(lang);
  if (mapLang) params.set('lang', mapLang);

  return `${baseUrl.replace(/\/$/, '')}/map?${params.toString()}`;
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
  buildRestaurantsBrowseMapUrl,
  buildPublicRestaurantMapUrl,
  buildOpenMapCtaUrl,
  getExplicitMapBaseUrl,
  getPublicMapBaseUrl,
  DEFAULT_MAX_PINS,
};
