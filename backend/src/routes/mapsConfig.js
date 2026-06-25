const express = require('express');
const { getMapsJsApiKey } = require('../lib/googleMaps');

const router = express.Router();
const DEFAULT_PUBLIC_API_BASE = 'https://whatorder-backend-6ehqrvd7yq-ey.a.run.app';

function publicApiBase() {
  const fromEnv = process.env.BACKEND_URL?.trim();
  if (fromEnv && !fromEnv.includes('localhost')) return fromEnv.replace(/\/$/, '');
  return DEFAULT_PUBLIC_API_BASE;
}

// GET /api/maps/config — public Maps JS key for whatorder.at/map (referrer-restricted key).
router.get('/maps/config', (req, res) => {
  const mapsApiKey = getMapsJsApiKey();
  if (!mapsApiKey) {
    return res.status(503).json({ error: 'Maps not configured' });
  }
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ apiBase: publicApiBase(), mapsApiKey });
});

module.exports = router;
