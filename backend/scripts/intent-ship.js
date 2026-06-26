#!/usr/bin/env node
/**
 * One-shot intent corpus ship: record (if new) → eval → promote → CI verify.
 * Re-run after fixing expect or parser; does not ship until eval passes.
 *
 * Usage:
 *   npm run intent:ship -- "Zwei Eiern noch dazu bitte"
 *   npm run intent:ship -- --id my-case --tag tts_typo "phrase"
 *   npm run intent:ship -- --id existing-candidate-id
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const fs = require('fs');
const path = require('path');
const { BUILTIN_MENU } = require('../src/bot/intentSandbox');
const { getMenu } = require('../src/bot/menuService');
const { formatEvalReport, shipIntentCase } = require('../src/bot/intentEval');

const HELP = `
Intent ship — record → eval candidate → promote → CI verify (one command).

If eval fails: fix expect in candidate.json and/or fix parser, then re-run the same command.
Nothing is promoted until the case passes. Re-running is idempotent.

Options:
  --id <slug>           Case id (for new record or existing candidate)
  --tag <name>          Tag on new record (repeatable)
  --notes <text>        Note on new record
  --dry-run             Eval + preview promote without writing files
  --business <id>       Firestore menu
  --menu <path>         Menu JSON file
  --lang de|en|tr       Locale (default: de)
  --llm                 Enable LLM paths
  --help, -h            Show this help

Examples:
  npm run intent:ship -- "Zwei Eiern noch dazu bitte"
  npm run intent:ship -- --tag tts_typo --notes "Enes pilot" "phrase"
  npm run intent:ship -- --id zwei-eiern-noch-dazu-bitte
`.trim();

function parseArgs(argv) {
  const opts = {
    id: null,
    tags: [],
    notes: null,
    dryRun: false,
    businessId: null,
    menuPath: null,
    llm: false,
    lang: 'de',
    phrases: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--id') {
      opts.id = argv[++i];
    } else if (arg === '--tag') {
      opts.tags.push(argv[++i]);
    } else if (arg === '--notes') {
      opts.notes = argv[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--business') {
      opts.businessId = argv[++i];
    } else if (arg === '--menu') {
      opts.menuPath = argv[++i];
    } else if (arg === '--lang') {
      opts.lang = argv[++i];
    } else if (arg === '--llm') {
      opts.llm = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      opts.phrases.push(arg);
    } else {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }

  if (!opts.phrases.length && !opts.id) {
    console.error('Missing phrase or --id.\n');
    console.log(HELP);
    process.exit(1);
  }
  return opts;
}

function loadMenuFromFile(filePath) {
  const abs = path.resolve(filePath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`Menu file must be a JSON array: ${abs}`);
  return data;
}

async function resolveMenu(opts) {
  if (opts.menuPath) {
    return {
      menu: loadMenuFromFile(opts.menuPath),
      menuRef: path.basename(opts.menuPath),
    };
  }
  if (opts.businessId) {
    const menu = await getMenu(opts.businessId);
    return { menu, menuRef: `firestore:${opts.businessId}` };
  }
  return { menu: BUILTIN_MENU, menuRef: 'builtin' };
}

function printEvalFailures(verifyRun) {
  console.error(`FAIL [${verifyRun.id}] eval did not pass:`);
  for (const f of verifyRun.failures) {
    console.error(`  • ${f}`);
  }
  console.error('');
  console.error('Fix expect in fixtures/intent-corpus/candidate.json and/or fix parser, then re-run intent:ship.');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const text = opts.phrases.join(' ').trim() || null;
  const { menuRef, menu } = await resolveMenu(opts);

  const result = await shipIntentCase(
    { text, id: opts.id },
    {
      dryRun: opts.dryRun,
      tags: opts.tags,
      notes: opts.notes,
      menuRef,
      lang: opts.lang,
      llm: opts.llm,
      evalOptions: {
        menu,
        lang: opts.lang,
        businessId: opts.businessId,
        llm: opts.llm,
      },
    },
  );

  switch (result.status) {
    case 'already_shipped':
      console.log(`Already shipped [${result.caseId}] — CI ${result.ciReport.passed}/${result.ciReport.total} passed`);
      break;
    case 'shipped_regression':
      console.error(`Shipped case [${result.caseId}] now fails regression:`);
      if (!result.verifyRun.pass) printEvalFailures(result.verifyRun);
      else console.error(formatEvalReport(result.ciReport, { verbose: true }));
      process.exit(1);
      break;
    case 'eval_failed':
      if (result.recorded) {
        console.log(`Recorded [${result.caseId}] → candidate.json (eval failed, not promoted)`);
      } else {
        console.log(`Candidate [${result.caseId}] still failing eval (not promoted)`);
      }
      printEvalFailures(result.verifyRun);
      process.exit(1);
      break;
    case 'dry_run':
      console.log(`Dry run OK [${result.caseId}] — would promote to builtin.json`);
      console.log(JSON.stringify(result.dryPromote.shipped, null, 2));
      break;
    case 'ci_failed':
      console.error(`Promoted [${result.caseId}] but CI corpus failed:`);
      console.error(formatEvalReport(result.ciReport, { verbose: true }));
      process.exit(1);
      break;
    case 'shipped':
      console.log(`Shipped [${result.caseId}] → builtin.json (${result.promoteResult.builtinTotal} cases)`);
      console.log(formatEvalReport(result.ciReport));
      break;
    default:
      console.error(`Unknown ship status: ${result.status}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
