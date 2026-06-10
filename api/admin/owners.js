const { admin } = require('../../backend/src/lib/firebase');
const { ownerRef, adminRef } = require('../../backend/src/lib/collections');

function normalizePhone(raw) {
  const stripped = raw.replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

async function requireAdmin(req, res) {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing auth token' });
    return null;
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
  } catch {
    res.status(401).json({ error: 'Invalid auth token' });
    return null;
  }
  const adminSnap = await adminRef(decoded.uid).get();
  if (!adminSnap.exists) {
    res.status(403).json({ error: 'Not an admin' });
    return null;
  }
  return decoded.uid;
}

function ensureBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { req.body = JSON.parse(req.body); } catch { req.body = {}; }
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += String(chunk); });
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      resolve();
    });
    req.on('error', () => { req.body = {}; resolve(); });
    setTimeout(() => { req.body = req.body ?? {}; resolve(); }, 3000);
  });
}

module.exports = async (req, res) => {
  // POST /admin/owners — create or link owner by phone number
  if (req.method === 'POST') {
    const callerUid = await requireAdmin(req, res);
    if (!callerUid) return;

    await ensureBody(req);
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
      try {
        userRecord = await admin.auth().createUser({ phoneNumber: normalizedPhone });
      } catch (createErr) {
        console.error('[admin/owners] createUser failed:', createErr);
        return res.status(500).json({ error: 'Failed to create user' });
      }
    }

    const { uid } = userRecord;
    await ownerRef(uid).set({ businessId, phone: normalizedPhone });
    return res.json({ uid, phone: normalizedPhone });
  }

  // DELETE /admin/owners?uid=<uid> — remove owner
  if (req.method === 'DELETE') {
    const callerUid = await requireAdmin(req, res);
    if (!callerUid) return;

    const uid = new URL(req.url, 'http://localhost').searchParams.get('uid');
    if (!uid) return res.status(400).json({ error: 'uid query param required' });

    await ownerRef(uid).delete();
    return res.json({ ok: true });
  }

  res.status(405).end();
};
