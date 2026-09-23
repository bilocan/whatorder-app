const crypto = require('crypto');
const express = require('express');
const { admin } = require('../lib/firebase');

const router = express.Router();

function secretMatches(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post('/wallboard/session', async (req, res) => {
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secretMatches(provided, process.env.WALLBOARD_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const token = await admin.auth().createCustomToken('wallboard', { wallboard: true });
    return res.json({ token });
  } catch (err) {
    console.error(`[wallboard] custom token failed: ${err.message}`);
    return res.status(500).json({ error: 'Token failed' });
  }
});

module.exports = router;
