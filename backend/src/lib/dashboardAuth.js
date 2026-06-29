const { admin } = require('./firebase');
const { ownerRef, adminRef } = require('./collections');

async function verifyBearerToken(req) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: { status: 401, message: 'Missing auth token' } };
  }
  try {
    const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    return { uid: decoded.uid };
  } catch {
    return { error: { status: 401, message: 'Invalid auth token' } };
  }
}

function ownerBusinessIds(ownerData) {
  if (!ownerData) return [];
  if (Array.isArray(ownerData.businessIds) && ownerData.businessIds.length) {
    return ownerData.businessIds;
  }
  return ownerData.businessId ? [ownerData.businessId] : [];
}

/** Any signed-in owner or admin (e.g. geocode). */
async function requireOwnerOrAdmin(req, res, next) {
  const auth = await verifyBearerToken(req);
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message });
  const [ownerSnap, adminSnap] = await Promise.all([
    ownerRef(auth.uid).get(),
    adminRef(auth.uid).get(),
  ]);
  if (!ownerSnap.exists && !adminSnap.exists) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  req.uid = auth.uid;
  req.isAdmin = adminSnap.exists;
  next();
}

/** Owner of req.params.businessId or admin. */
async function requireOwnerOfBusiness(req, res, next) {
  const { businessId } = req.params;
  if (!businessId) return res.status(400).json({ error: 'businessId is required' });

  const auth = await verifyBearerToken(req);
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message });

  const [ownerSnap, adminSnap] = await Promise.all([
    ownerRef(auth.uid).get(),
    adminRef(auth.uid).get(),
  ]);
  if (adminSnap.exists) {
    req.uid = auth.uid;
    req.isAdmin = true;
    return next();
  }
  if (!ownerSnap.exists) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const ids = ownerBusinessIds(ownerSnap.data());
  if (!ids.includes(businessId)) {
    return res.status(403).json({ error: 'Not authorized for this business' });
  }
  req.uid = auth.uid;
  req.isAdmin = false;
  next();
}

module.exports = {
  requireOwnerOrAdmin,
  requireOwnerOfBusiness,
};
