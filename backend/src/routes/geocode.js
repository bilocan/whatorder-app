const express = require('express');
const { requireOwnerOrAdmin } = require('../lib/dashboardAuth');
const { forwardGeocode } = require('../lib/geocode');

const router = express.Router();

// POST /api/geocode  { address: string } → { lat, lng } or 404
router.post('/geocode', requireOwnerOrAdmin, async (req, res) => {
  const { address } = req.body ?? {};
  if (!address?.trim()) {
    return res.status(400).json({ error: 'address is required' });
  }
  try {
    const result = await forwardGeocode(address);
    if (!result) return res.status(404).json({ error: 'Address not found' });
    res.json(result);
  } catch (err) {
    console.error('[geocode] forward lookup failed:', err);
    res.status(500).json({ error: 'Geocode failed' });
  }
});

module.exports = router;
