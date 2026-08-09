'use strict';

/**
 * Contabo diagnose: open WA Web with the e2e profile and print login signals.
 *
 * Exit codes (Phase 8 nightly contract):
 *   0 — hasChatList, usable
 *   2 — session dead (QR / no chat list / login failure) → workflow fails the job
 *   1 — unexpected error
 *
 *   xvfb-run -a node e2e-wa/scripts/wa-web-diagnose.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
require('dotenv').config();

const { loadConfig } = require('../lib/config');
const { WaWebCustomer, SEL, detectLoginFailure } = require('../lib/waWebCustomer');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

  // Poll like assertLoggedIn — single 8s snapshot was too eager under xvfb.
  const timeoutMs = Number(cfg.webLoginTimeoutMs) || 60_000;
  const deadline = Date.now() + timeoutMs;
  let last = { hasChatList: false, hasQr: false, bodyText: '' };

  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    const hasChatList = await page.locator(SEL.chatList).first().isVisible().catch(() => false);
    // Match WaWebCustomer.assertLoggedIn: canvas alone is not QR.
    const hasQr = /zum anmelden scannen|scan to log|qr code|abgemeldet|verifizieren/i.test(body)
      && await page.locator(SEL.qrCanvas).first().isVisible().catch(() => false);
    last = { hasChatList, hasQr, bodyText: body.slice(0, 800) };

    console.log('hasChatList=', hasChatList, 'hasQr=', hasQr);

    const fail = detectLoginFailure(last);
    if (!fail) {
      console.log('url=', page.url());
      console.log('title=', await page.title());
      console.log('body preview:\n', last.bodyText.slice(0, 600));
      await customer._dumpDebug('diagnose', last);
      await customer.close();
      console.log('diagnose ok');
      process.exit(0);
    }

    if (
      hasQr
      || /abgemeldet|verifizieren|phone not connected|chrome ab version|aktualisiere chrome/i.test(body)
    ) {
      break;
    }
    await sleep(2_000);
  }

  console.log('url=', page.url());
  console.log('title=', await page.title().catch(() => ''));
  console.log('body preview:\n', last.bodyText.slice(0, 600));
  await customer._dumpDebug('diagnose', last);
  await customer.close();

  const fail = detectLoginFailure(last)
    || 'WhatsApp Web chat list not found — not logged in or DOM changed.';
  console.error('SESSION_DEAD:', fail);
  console.error('Re-link WhatsApp Web on Contabo via Chrome Remote Desktop, then re-run.');
  process.exit(2);
}

main().catch((err) => {
  console.error('diagnose failed:', err.message);
  process.exit(1);
});
