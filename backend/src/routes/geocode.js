const express = require('express');
const { admin } = require('../lib/firebase');
const { ownerRef, adminRef } = require('../lib/collections');
const { forwardGeocode } = require('../lib/geocode');

const router = express.Router();

async function requireOwnerOrAdmin(req, res, next) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }
  const token = authHeader.slice(7);
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
  const [ownerSnap, adminSnap] = await Promise.all([
    ownerRef(decoded.uid).get(),
    adminRef(decoded.uid).get(),
  ]);
  if (!ownerSnap.exists && !adminSnap.exists) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  req.uid = decoded.uid;
  next();
}

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
