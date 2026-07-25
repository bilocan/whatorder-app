'use strict';

/**
 * WhatsApp real E2E CLI.
 *
 * Usage:
 *   cd backend
 *   npm run e2e:wa:reply-server   # terminal 1 (+ ngrok for Meta customer webhook)
 *   npm run e2e:wa -- --scenario happy_cash_pickup
 *   npm run e2e:wa -- --all-pack-a
 *   npm run e2e:wa -- --all-pack-b
 *   npm run e2e:wa -- --all
 *
 * Requires E2E_WA_CUSTOMER_ACCESS_TOKEN after Meta phone verification.
 * Spec: whatorder-vault/.../feature-whatsapp-e2e-automation.md
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config();

const { loadConfig, TEST_BUSINESS_PHONE_NUMBER_ID } = require('./lib/config');
const { WaE2eSession } = require('./lib/session');
const { BY_ID, resolveScenarioIds, listScenarios } = require('./scenarios');

function printHelp() {
  console.log(`e2e-wa — real Meta WhatsApp E2E against Test line

Options:
  --scenario <id>   Run one scenario (repeatable)
  --all-pack-a      happy_cash_pickup + owner_status_path
  --all-pack-b      neg_closed + neg_delivery_minimum + neg_cancel
  --all             All scenarios
  --list            List scenario ids
  --help

Default (no flags): pack A (happy + owner).

Scenarios:
${listScenarios().map((s) => `  ${s.id}  (pack ${s.pack})`).join('\n')}
`);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  if (argv.includes('--list')) {
    for (const s of listScenarios()) console.log(`${s.id}\tpack=${s.pack}`);
    return 0;
  }

  if (!process.env.E2E_WA_BUSINESS_PHONE_NUMBER_ID) {
    process.env.E2E_WA_BUSINESS_PHONE_NUMBER_ID = TEST_BUSINESS_PHONE_NUMBER_ID;
  }
  if (!process.env.E2E_WA_REPLY_BUFFER_URL) {
    process.env.E2E_WA_REPLY_BUFFER_URL = `http://127.0.0.1:${process.env.E2E_WA_REPLY_PORT || 3099}`;
  }

  const cfg = loadConfig(process.env, { requireSecrets: true });
  const ids = resolveScenarioIds(argv);

  for (const id of ids) {
    if (!BY_ID[id]) {
      throw new Error(`Unknown scenario: ${id}. Use --list`);
    }
  }

  console.log(`[e2e-wa] business=${cfg.businessDisplay} customer=${cfg.customerDisplay} biz=${cfg.businessId}`);
  console.log(`[e2e-wa] scenarios: ${ids.join(', ')}`);
  console.log(`[e2e-wa] reply buffer: ${cfg.replyBufferUrl}`);

  const session = await WaE2eSession.create(cfg);
  const results = [];

  for (const id of ids) {
    const started = Date.now();
    console.log(`\n=== ${id} ===`);
    try {
      const out = await BY_ID[id].run(session);
      results.push({ id, ok: true, ms: Date.now() - started, out });
      console.log(`[e2e-wa] PASS ${id} (${Date.now() - started}ms)`);
    } catch (err) {
      results.push({ id, ok: false, ms: Date.now() - started, error: err.message });
      console.error(`[e2e-wa] FAIL ${id}: ${err.message}`);
      // Stop pack A chain on failure so owner does not run without order
      if (id === 'happy_cash_pickup') break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[e2e-wa] ${results.length - failed.length}/${results.length} passed`);
  return failed.length ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error('[e2e-wa] fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { main, printHelp };
