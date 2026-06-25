const { isConfigured, geocodeForward: googleForward, geocodeReverse: googleReverse } = require('./googleMaps');

async function nominatimReverse(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WhatOrder/1.0 (contact@whatorder.app)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.display_name ?? null;
  } catch {
    return null;
  }
}

async function nominatimForward(address) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WhatOrder/1.0 (restaurant management)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

async function reverseGeocode(lat, lng) {
  if (isConfigured()) {
    try {
      const google = await googleReverse(lat, lng);
      if (google) return google;
    } catch { /* fall through */ }
  }
  return nominatimReverse(lat, lng);
}

async function forwardGeocode(address) {
  if (!address?.trim()) return null;
  if (isConfigured()) {
    try {
      const google = await googleForward(address);
      if (google) return google;
    } catch { /* fall through */ }
  }
  return nominatimForward(address);
}

module.exports = { reverseGeocode, forwardGeocode, nominatimReverse, nominatimForward };
