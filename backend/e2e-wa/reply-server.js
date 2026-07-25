'use strict';

/**
 * Customer WABA reply-capture process.
 * Meta Callback URL: https://<host>/webhooks/customer
 *
 * Usage: E2E_WA_CUSTOMER_VERIFY_TOKEN=... npm run e2e:wa:reply-server
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
require('dotenv').config();

const { ReplyBuffer } = require('./lib/replyBuffer');
const { createReplyApp } = require('./lib/replyServer');
const { loadConfig } = require('./lib/config');

const buffer = new ReplyBuffer();
// Secrets for Graph send not required just to capture replies
const cfg = loadConfig(process.env, { requireSecrets: false });
const verifyToken = process.env.E2E_WA_CUSTOMER_VERIFY_TOKEN || cfg.customerVerifyToken || 'e2e-wa-verify';
const port = Number(process.env.E2E_WA_REPLY_PORT || cfg.replyPort || 3099);

const app = createReplyApp({ buffer, verifyToken });
app.listen(port, () => {
  console.log(`[e2e-wa] reply server on :${port}  POST/GET /webhooks/customer  verify_token set`);
});
