const { verifyWebhook, receiveWebhook } = require('../../backend/src/controllers/webhookController');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) { resolve(); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      resolve();
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return verifyWebhook(req, res);
  if (req.method === 'POST') {
    await parseBody(req);
    return receiveWebhook(req, res);
  }
  res.status(405).end();
};
