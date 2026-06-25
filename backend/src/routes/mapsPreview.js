const express = require('express');
const { buildRestaurantsStaticMapUrl, parsePinsParam } = require('../lib/mapsUrl');
const { getApiKey } = require('../lib/googleMaps');

const router = express.Router();
const MAP_FETCH_TIMEOUT_MS = 5000;

// GET /api/maps/restaurants-preview?clat=&clng=&pins=lat,lng|lat,lng
// Public image proxy — WhatsApp fetches this URL (not Google directly).
router.get('/maps/restaurants-preview', async (req, res) => {
  const clat = parseFloat(req.query.clat);
  const clng = parseFloat(req.query.clng);
  const businesses = parsePinsParam(String(req.query.pins ?? ''));
  const apiKey = getApiKey();

  if (!Number.isFinite(clat) || !Number.isFinite(clng) || !businesses.length || !apiKey) {
    return res.status(400).send('Bad request');
  }

  const staticUrl = buildRestaurantsStaticMapUrl(clat, clng, businesses, apiKey);
  if (!staticUrl) return res.status(400).send('Bad request');

  try {
    const imgRes = await fetch(staticUrl, { signal: AbortSignal.timeout(MAP_FETCH_TIMEOUT_MS) });
    if (!imgRes.ok) {
      const body = await imgRes.text().catch(() => '');
      console.error(`[maps-preview] Google Static Maps ${imgRes.status}: ${body.slice(0, 200)}`);
      return res.status(502).send('Map unavailable');
    }
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      const body = await imgRes.text().catch(() => '');
      console.error(`[maps-preview] unexpected content-type ${contentType}: ${body.slice(0, 200)}`);
      return res.status(502).send('Map unavailable');
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    return res.send(buf);
  } catch (err) {
    console.error('[maps-preview] fetch failed:', err.message);
    return res.status(502).send('Map unavailable');
  }
});

module.exports = router;
