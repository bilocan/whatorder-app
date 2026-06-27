const { adminRef } = require('./collections');
const { admin } = require('./firebase');

async function requireAdmin(req, res, next) {
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
  const adminSnap = await adminRef(decoded.uid).get();
  if (!adminSnap.exists) {
    return res.status(403).json({ error: 'Not an admin' });
  }
  req.adminUid = decoded.uid;
  next();
}

module.exports = { requireAdmin };
