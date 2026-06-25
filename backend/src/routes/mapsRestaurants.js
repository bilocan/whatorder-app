const express = require('express');
const { businessRef } = require('../lib/collections');
const { sortByDistance } = require('../lib/distance');

const router = express.Router();

function parseCoord(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function toPin(b) {
  return {
    id: b.id,
    name: b.name,
    lat: parseCoord(b.lat),
    lng: parseCoord(b.lng),
    address: b.address ?? null,
    distanceKm: b.distanceKm ?? null,
    durationMin: b.durationMin ?? null,
  };
}

// GET /api/maps/restaurants?ids=biz_a,biz_b&clat=&clng=
// Public pin data for customer map on whatorder.at. Optional clat/clng → driving distance + sort (same as WhatsApp picker).
router.get('/maps/restaurants', async (req, res) => {
  try {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!ids.length) {
      return res.status(400).json({ error: 'ids query parameter is required' });
    }

    const docs = await Promise.all(ids.map((id) => businessRef(id).get()));

    let restaurants = docs
      .map((d) => (d.exists ? { id: d.id, ...d.data() } : null))
      .filter(Boolean)
      .map((b) => ({
        id: b.id,
        name: b.name,
        lat: parseCoord(b.lat),
        lng: parseCoord(b.lng),
        address: b.address ?? null,
      }))
      .filter((b) => b.lat != null && b.lng != null);

    const clat = parseCoord(req.query.clat);
    const clng = parseCoord(req.query.clng);
    if (clat != null && clng != null) {
      restaurants = await sortByDistance(restaurants, clat, clng);
    }

    res.json({ restaurants: restaurants.map(toPin) });
  } catch (err) {
    console.error('[maps-restaurants] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load restaurants' });
  }
});

module.exports = router;
