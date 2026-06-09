const { verifyWebhook, receiveWebhook } = require('../../backend/src/controllers/webhookController');

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
  console.log('[whatsapp-fn] received', req.method, 'body type:', typeof req.body);
  if (req.method === 'GET') return verifyWebhook(req, res);
  if (req.method === 'POST') {
    await ensureBody(req);
    console.log('[whatsapp-fn] body parsed, entry count:', req.body?.entry?.length ?? 0);
    return receiveWebhook(req, res);
  }
  res.status(405).end();
};
