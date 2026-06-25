#!/usr/bin/env node
/**
 * Intent corpus eval — run golden phrases through evaluateIntent and report pass/fail.
 *
 * Usage:
 *   npm run intent:eval
 *   npm run intent:eval -- --verbose
 *   npm run intent:eval -- --tag modifier
 *   npm run intent:eval -- --file builtin.json
 */
const { formatEvalReport, runCorpusEval } = require('../src/bot/intentEval');

const HELP = `
Intent corpus eval — golden phrases → parse/match assertions (rules-only by default).

Options:
  --file <name>     Corpus file under fixtures/intent-corpus/ (default: all shipped cases)
  --candidate       Run candidate.json only (harvest queue; failures expected)
  --ci              Run builtin.json only (same as CI Jest gate)
  --tag <name>      Run only cases with this tag
  --llm             Enable LLM paths (needs API keys; not for CI)
  --verbose, -v     Print each case or extra failure detail
  --json            Print raw report JSON
  --help, -h        Show this help
`.trim();

function parseArgs(argv) {
  const opts = {
    file: null,
    tag: null,
    llm: false,
    verbose: false,
    json: false,
    candidate: false,
    ci: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      opts.file = argv[++i];
    } else if (arg === '--tag') {
      opts.tag = argv[++i];
    } else if (arg === '--candidate') {
      opts.candidate = true;
    } else if (arg === '--ci') {
      opts.ci = true;
    } else if (arg === '--llm') {
      opts.llm = true;
    } else if (arg === '--verbose' || arg === '-v') {
      opts.verbose = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let mode = 'shipped';
  if (opts.ci) mode = 'ci';
  else if (opts.candidate) mode = 'candidate';

  const report = await runCorpusEval({
    file: opts.file,
    tag: opts.tag,
    llm: opts.llm,
    mode,
  });

  if (opts.json) {
    console.log(JSON.stringify({
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      failures: report.failures.map(f => ({
        id: f.id,
        text: f.text,
        errors: f.failures,
        outcome: f.result.outcome,
        parsedBy: f.result.intent?.parsedBy,
      })),
    }, null, 2));
  } else {
    console.log(formatEvalReport(report, { verbose: opts.verbose }));
  }

  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
