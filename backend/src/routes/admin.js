const express = require('express');
const { admin, db } = require('../lib/firebase');
const { ownerRef, adminRef } = require('../lib/collections');
const { requireAdmin } = require('../lib/adminAuth');

const router = express.Router();

// Normalize to E.164: strips spaces/dashes, ensures leading +
function normalizePhone(raw) {
  const stripped = raw.replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

// POST /admin/check-phone  (public — no auth required)
// Returns { allowed: true } only if the phone is registered as an owner or admin.
// Called by the dashboard login page before triggering Firebase phone OTP so we
// never send an SMS to a number that isn't in our system.
router.post('/check-phone', async (req, res) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ allowed: false });

  const normalizedPhone = normalizePhone(phone);

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByPhoneNumber(normalizedPhone);
  } catch (err) {
    if (err.code === 'auth/user-not-found') return res.json({ allowed: false });
    console.error('[admin/check-phone] auth lookup failed:', err);
    return res.status(500).json({ allowed: false });
  }

  const [ownerSnap, adminSnap] = await Promise.all([
    ownerRef(userRecord.uid).get(),
    adminRef(userRecord.uid).get(),
  ]);

  res.json({ allowed: ownerSnap.exists || adminSnap.exists });
});

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
