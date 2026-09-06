const crypto = require('crypto');

function tokenSecret() {
  return process.env.RESTAURANT_BUNDLE_TOKEN_SECRET
    || process.env.WHATSAPP_APP_SECRET
    || 'dev-restaurant-bundle-token';
}

function createImportToken({ adminUid, objectKey, exp = Date.now() + 15 * 60 * 1000, firestoreDatabaseId, contentSha256 }) {
  const payload = {
    adminUid,
    objectKey,
    firestoreDatabaseId,
    exp,
  };
  if (contentSha256) payload.contentSha256 = contentSha256;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyImportToken(token, { adminUid, firestoreDatabaseId, now = Date.now() } = {}) {
  const err403 = (message) => {
    const err = new Error(message);
    err.status = 403;
    return err;
  };
  if (!token || typeof token !== 'string' || token.includes('/') || token.startsWith('gs://')) {
    throw err403('Invalid import token');
  }
  const [body, sig] = token.split('.');
  if (!body || !sig) throw err403('Invalid import token');
  const expected = crypto.createHmac('sha256', tokenSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw err403('Invalid import token');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw err403('Invalid import token');
  }
  if (payload.exp && payload.exp < now) throw err403('Import token expired');
  if (adminUid && payload.adminUid !== adminUid) throw err403('Import token belongs to another admin');
  if (firestoreDatabaseId && payload.firestoreDatabaseId !== firestoreDatabaseId) {
    throw err403('Import token does not match this environment');
  }
  return payload;
}

function rejectRawGcsPath(body) {
  if (body && (body.gcsPath || body.gsUrl || body.signedUrl)) {
    const err = new Error('Raw gcsPath is not accepted; upload via importToken');
    err.status = 400;
    throw err;
  }
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function assertPreviewChecksum(payload, buffer) {
  if (!payload?.contentSha256) {
    const err = new Error('Preview the file before import');
    err.status = 400;
    throw err;
  }
  const actual = sha256Buffer(buffer);
  if (actual !== payload.contentSha256) {
    const err = new Error('Bundle changed after preview; upload and preview again');
    err.status = 409;
    throw err;
  }
}

module.exports = {
  createImportToken,
  verifyImportToken,
  rejectRawGcsPath,
  sha256Buffer,
  assertPreviewChecksum,
};
