'use strict';

/**
 * Contabo diagnose: open WA Web with the e2e profile and print login signals.
 *
 * Exit codes (Phase 8 nightly contract):
 *   0 — hasChatList, usable
 *   2 — session dead (QR / no chat list / login failure) → workflow soft-skip
 *   1 — unexpected error
 *
 *   xvfb-run -a node e2e-wa/scripts/wa-web-diagnose.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
require('dotenv').config();

const { loadConfig } = require('../lib/config');
const { WaWebCustomer, SEL, detectLoginFailure } = require('../lib/waWebCustomer');

async function main() {
  process.env.E2E_WA_CUSTOMER_TRANSPORT = process.env.E2E_WA_CUSTOMER_TRANSPORT || 'wa-web';
  if (!process.env.E2E_WA_WEB_USER_DATA_DIR) {
    process.env.E2E_WA_WEB_USER_DATA_DIR = '/var/lib/whatorder-e2e/wa-web-profile';
  }
  // diagnose defaults to headed
  if (process.env.E2E_WA_WEB_HEADLESS === undefined) {
    process.env.E2E_WA_WEB_HEADLESS = '0';
  }

  const cfg = loadConfig(process.env, { requireSecrets: true });
  console.log('profile=', cfg.webUserDataDir);
  console.log('headless=', cfg.webHeadless, 'DISPLAY=', process.env.DISPLAY || '(none)');

  const customer = new WaWebCustomer(cfg);
  await customer.launch();
  const page = customer._page;
  await new Promise((r) => setTimeout(r, 8000));

  const body = await page.locator('body').innerText().catch(() => '');
  const hasChatList = await page.locator(SEL.chatList).first().isVisible().catch(() => false);
  const hasQr = await page.locator(SEL.qrCanvas).first().isVisible().catch(() => false);
  console.log('url=', page.url());
  console.log('title=', await page.title());
  console.log('hasChatList=', hasChatList, 'hasQrCanvas=', hasQr);
  console.log('body preview:\n', body.slice(0, 600));

  await customer._dumpDebug('diagnose', { bodyText: body });
  await customer.close();

  const fail = detectLoginFailure({ hasChatList, hasQr, bodyText: body });
  if (fail) {
    console.error('SESSION_DEAD:', fail);
    console.error('Re-link WhatsApp Web on Contabo via Chrome Remote Desktop, then re-run.');
    process.exit(2);
  }
  if (!hasChatList) {
    console.error('SESSION_DEAD: chat list not visible');
    process.exit(2);
  }
  console.log('diagnose ok');
  process.exit(0);
}

main().catch((err) => {
  console.error('diagnose failed:', err.message);
  process.exit(1);
});
