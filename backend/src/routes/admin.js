const express = require('express');
const { admin, db } = require('../lib/firebase');
const { ownerRef, adminRef } = require('../lib/collections');

const router = express.Router();

// Verify the caller holds a valid Firebase ID token AND is in admins/{uid}
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

// Normalize to E.164: strips spaces/dashes, ensures leading +
function normalizePhone(raw) {
  const stripped = raw.replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

// POST /admin/owners
// Body: { phone: string, businessId: string }
// Looks up or creates the Firebase Auth user, then writes owners/{uid}
router.post('/owners', requireAdmin, async (req, res) => {
  const { phone, businessId } = req.body ?? {};
  if (!phone || !businessId) {
    return res.status(400).json({ error: 'phone and businessId are required' });
  }

  const normalizedPhone = normalizePhone(phone);

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByPhoneNumber(normalizedPhone);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      console.error('[admin/owners] auth lookup failed:', err);
      return res.status(500).json({ error: 'Auth lookup failed' });
    }
    // Pre-create the account — owner can sign in via phone OTP later
    try {
      userRecord = await admin.auth().createUser({ phoneNumber: normalizedPhone });
    } catch (createErr) {
      console.error('[admin/owners] createUser failed:', createErr);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  }

  const { uid } = userRecord;
  await ownerRef(uid).set(
    {
      businessId,
      phone: normalizedPhone,
      businessIds: admin.firestore.FieldValue.arrayUnion(businessId),
    },
    { merge: true },
  );

  res.json({ uid, phone: normalizedPhone });
});

// DELETE /admin/owners?uid=<uid>
router.delete('/owners', requireAdmin, async (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ error: 'uid query param required' });
  await ownerRef(uid).delete();
  res.json({ ok: true });
});

module.exports = router;
