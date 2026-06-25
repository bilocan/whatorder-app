#!/usr/bin/env node
/**
 * Promote passing candidate cases into builtin.json (CI corpus).
 *
 * Usage:
 *   npm run intent:promote -- zwei-eiern-noch-dazu-bitte
 *   npm run intent:promote -- --all
 *   npm run intent:promote -- --dry-run zwei-eiern-noch-dazu-bitte
 */
const { formatEvalReport, promoteAllCases, promoteCase, runCorpusEval } = require('../src/bot/intentEval');

const HELP = `
Intent promote — move verified candidate cases into builtin.json (CI gate).

Prerequisites:
  1. npm run intent:record -- "phrase"
  2. Edit expect in candidate.json if needed; fix parser until green
  3. npm run intent:eval -- --candidate
  4. npm run intent:promote -- <case-id>

Options:
  <case-id>           One or more ids to promote (required unless --all)
  --all               Promote every candidate that passes eval
  --dry-run           Show what would be promoted without writing files
  --skip-verify       Promote without re-running eval (avoid)
  --continue          With --all, keep going after a failure
  --verify-ci         Run builtin corpus eval after promote
  --help, -h          Show this help
`.trim();

function parseArgs(argv) {
  const opts = {
    ids: [],
    all: false,
    dryRun: false,
    skipVerify: false,
    continueOnError: false,
    verifyCi: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--skip-verify') {
      opts.skipVerify = true;
    } else if (arg === '--continue') {
      opts.continueOnError = true;
    } else if (arg === '--verify-ci') {
      opts.verifyCi = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      opts.ids.push(arg);
    } else {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }

  if (!opts.all && !opts.ids.length) {
    console.error('Missing case id. Pass one or more ids, or use --all.\n');
    console.log(HELP);
    process.exit(1);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const promoteOpts = {
    dryRun: opts.dryRun,
    skipVerify: opts.skipVerify,
    continueOnError: opts.continueOnError,
  };

  if (opts.all) {
    const results = await promoteAllCases(promoteOpts);
    for (const r of results) {
      if (r.ok) {
        const { shipped, builtinTotal, candidateRemaining } = r.result;
        console.log(`Promoted [${r.id}] → builtin.json (${builtinTotal} shipped, ${candidateRemaining} candidates left)`);
        console.log(`  text: ${shipped.text.slice(0, 60)}${shipped.text.length > 60 ? '…' : ''}`);
      } else {
        console.error(`SKIP [${r.id}]: ${r.error}`);
        if (r.failures?.length) {
          for (const f of r.failures) console.error(`  • ${f}`);
        }
      }
    }
    const ok = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log(`\nPromote: ${ok} promoted, ${fail} skipped`);
    if (fail > 0 && !opts.continueOnError) process.exit(1);
  } else {
    for (const id of opts.ids) {
      const result = await promoteCase(id, promoteOpts);
      if (result.dryRun) {
        console.log(`Dry run — would promote [${id}] to builtin.json`);
        console.log(JSON.stringify(result.shipped, null, 2));
      } else {
        console.log(`Promoted [${id}] → builtin.json (${result.builtinTotal} shipped, ${result.candidateRemaining} candidates left)`);
      }
    }
  }

  if (opts.verifyCi && !opts.dryRun) {
    const report = await runCorpusEval({ mode: 'ci', llm: false });
    console.log(formatEvalReport(report));
    if (report.failed > 0) process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  if (err.failures?.length) {
    for (const f of err.failures) console.error(`  • ${f}`);
  }
  process.exit(1);
});
