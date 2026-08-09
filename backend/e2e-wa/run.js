'use strict';

/**
 * WhatsApp real E2E CLI.
 *
 * Contabo (preferred):
 *   E2E_WA_CUSTOMER_TRANSPORT=wa-web
 *   E2E_WA_WEB_USER_DATA_DIR=/var/lib/whatorder-e2e/wa-web-profile
 *   npm run e2e:wa -- --scenario happy_stripe_pickup
 *
 * Legacy dual Cloud API customer (deprecated for pack A):
 *   npm run e2e:wa:reply-server + E2E_WA_CUSTOMER_ACCESS_TOKEN
 *
 * Spec: whatorder-vault/.../feature-whatsapp-e2e-automation.md
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config();

const { loadConfig, targetFromArgv, TARGETS } = require('./lib/config');
const { WaE2eSession } = require('./lib/session');
const { BY_ID, resolveScenarioIds, listScenarios } = require('./scenarios');

function printHelp() {
  console.log(`e2e-wa — real Meta WhatsApp E2E (configurable bot target)

Transport (E2E_WA_CUSTOMER_TRANSPORT):
  wa-web   Contabo WhatsApp Web + Playwright (preferred)
  graph    Dual Cloud API customer (deprecated for pack A)

Targets (E2E_WA_TARGET or --target):
${Object.entries(TARGETS).map(([k, v]) => `  ${k.padEnd(12)} ${v.businessDisplay}  (${v.label})`).join('\n')}

Options:
  --target <name>   test | test-benat | preprod | prod (prod needs E2E_WA_ALLOW_PROD=1)
  --scenario <id>   Run one scenario (repeatable)
  --script <id>     Run one YAML script (repeatable)
  --all-pack-a      happy_stripe_pickup + owner_status_path + happy_stripe_delivery
  --all-pack-b      neg_closed + neg_delivery_minimum + neg_cancel
  --all-pack-c      All YAML pack C scripts
  --all             All JS scenarios (packs A + B only)
  --list            List JS and YAML scenario ids
  --help

Default: --target test, pack A (happy + owner).

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

  const targetArg = targetFromArgv(argv);
  if (targetArg) process.env.E2E_WA_TARGET = targetArg;

  const transportPeek = String(process.env.E2E_WA_CUSTOMER_TRANSPORT || 'graph').toLowerCase();
  const isWaWeb = transportPeek === 'wa-web' || transportPeek === 'web';

  if (!isWaWeb && !process.env.E2E_WA_REPLY_BUFFER_URL) {
    process.env.E2E_WA_REPLY_BUFFER_URL = `http://127.0.0.1:${process.env.E2E_WA_REPLY_PORT || 3099}`;
  }

  const cfg = loadConfig(process.env, { requireSecrets: true, target: process.env.E2E_WA_TARGET });
  const ids = resolveScenarioIds(argv);

  for (const id of ids) {
    if (!BY_ID[id]) {
      throw new Error(`Unknown scenario: ${id}. Use --list`);
    }
  }

  console.log(`[e2e-wa] transport=${cfg.customerTransport}`);
  console.log(`[e2e-wa] target=${cfg.target} (${cfg.targetLabel}) business=${cfg.businessDisplay}`);
  console.log(`[e2e-wa] customer=${cfg.customerDisplay} biz=${cfg.businessId}`);
  console.log(`[e2e-wa] scenarios: ${ids.join(', ')}`);
  if (cfg.customerTransport === 'wa-web') {
    console.log(`[e2e-wa] wa-web profile: ${cfg.webUserDataDir} headless=${cfg.webHeadless}`);
  } else {
    console.log(`[e2e-wa] reply buffer: ${cfg.replyBufferUrl}`);
  }

  const session = await WaE2eSession.create(cfg);
  const results = [];

  try {
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
        if (id === 'happy_stripe_pickup' || id === 'happy_cash_pickup') break;
      }
    }
  } finally {
    await session.close().catch(() => {});
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
