const express = require('express');
const { db } = require('../lib/firebase');
const { businessRef } = require('../lib/collections');

const router = express.Router();

function parseCoord(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// GET /api/maps/restaurants?ids=biz_a,biz_b
// Public pin data for the interactive map (name + coordinates only).
router.get('/maps/restaurants', async (req, res) => {
  try {
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    let docs;
    if (ids.length) {
      docs = await Promise.all(ids.map((id) => businessRef(id).get()));
    } else {
      const snap = await db.collection('businesses').get();
      docs = snap.docs;
    }

    const restaurants = docs
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

    res.json({ restaurants });
  } catch (err) {
    console.error('[maps-restaurants] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load restaurants' });
  }
});

module.exports = router;
