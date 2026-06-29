#!/usr/bin/env node
/**
 * Batch-run phrases from restaurants/<slug>/phrases.txt (one phrase per line).
 *
 * Usage:
 *   npm run intent:harvest -- --restaurant enes
 *   npm run intent:harvest -- --restaurant enes --verbose
 *   npm run intent:harvest -- --restaurant enes --interactive
 *   npm run intent:harvest -- --restaurant enes --record --eval
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  buildEvalContext,
  ensurePhrasesTxtScaffold,
  evaluateHarvestPhrase,
  formatHarvestReport,
  formatInteractiveSessionSummary,
  formatPhraseDetail,
  phraseAlreadyInPilot,
  recordSinglePhrase,
  resolveHarvestInput,
  runHarvestBatch,
} = require('../src/bot/intentHarvest');
const { runCorpusEval } = require('../src/bot/intentEval');
const { DEFAULT_CORPUS_DIR } = require('../src/bot/corpusLayout');

const HELP = `
Intent harvest — try phrases from phrases.txt, see results, record passes.

Input (pick one):
  restaurants/<slug>/phrases.txt   one phrase per line (# = comment)  ← default
  restaurants/<slug>/harvest.json  advanced (optional expect blocks)

Simple workflow:
  1. Edit phrases.txt — paste one phrase per line
  2. npm run intent:harvest -- --restaurant enes --verbose
  3. Fix failures (parser/aliases) or edit phrases.txt; re-run
  4. npm run intent:harvest -- --restaurant enes --record --eval

Interactive (step through + record per phrase):
  npm run intent:harvest -- --restaurant enes --interactive

Options:
  --restaurant <slug>   Tenant slug (e.g. enes)
  --enes                Alias for --restaurant enes
  --file <path>         Custom .txt or .json file
  --init                Create empty phrases.txt
  --verbose             Show full matched lines per phrase
  --interactive, -i     Step through phrases; [Enter]/[r]ecord/[s]kip/[q]uit
  --record              Record passing phrases to pilot.json
  --candidate           Record failures to candidate.json
  --write               Write phrases.last-run.json after run (txt input)
  --eval                Run intent:eval after --record
  --allow-llm           Count LLM as green
  --help, -h            Show this help
`.trim();

function parseArgs(argv) {
  const opts = {
    slug: null,
    file: null,
    init: false,
    verbose: false,
    interactive: false,
    writeManifest: false,
    record: false,
    candidate: false,
    runEval: false,
    allowLlm: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--restaurant') opts.slug = argv[++i];
    else if (arg === '--enes') opts.slug = 'enes';
    else if (arg === '--file') opts.file = argv[++i];
    else if (arg === '--init') opts.init = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--interactive' || arg === '-i') opts.interactive = true;
    else if (arg === '--write') opts.writeManifest = true;
    else if (arg === '--record') opts.record = true;
    else if (arg === '--candidate') opts.candidate = true;
    else if (arg === '--eval') opts.runEval = true;
    else if (arg === '--allow-llm') opts.allowLlm = true;
    else if (arg === '--fill-expect') { /* legacy no-op for txt mode */ }
    else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }

  if (!opts.slug && !opts.file) {
    console.error('Pass --restaurant <slug> or --file <path>\n');
    console.log(HELP);
    process.exit(1);
  }
  return opts;
}

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function runInteractive(manifest, opts) {
  const slug = opts.slug ?? manifest.restaurant;
  const corpusDir = DEFAULT_CORPUS_DIR;
  const evalCtx = buildEvalContext(slug, {
    corpusDir,
    businessId: manifest.businessId,
    llm: opts.allowLlm,
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const stats = {
    total: manifest.phrases.length,
    reviewed: 0,
    recorded: 0,
    skipped: 0,
    skippedPassedNew: 0,
    alreadyInPilot: 0,
    quitEarly: false,
    remaining: 0,
  };
  let quit = false;

  console.log(`Interactive harvest (${manifest.phrases.length} phrases). Keys: Enter=next, r=record, s=skip, q=quit\n`);

  for (const phrase of manifest.phrases) {
    if (quit) break;
    const run = await evaluateHarvestPhrase(phrase, evalCtx, { allowLlm: opts.allowLlm });
    const inPilot = phraseAlreadyInPilot(slug, run.text, corpusDir);
    console.log(formatPhraseDetail(run));
    if (!run.skipped && inPilot) {
      console.log('  pilot: already recorded');
    } else if (!run.skipped && run.pass) {
      console.log('  pilot: not recorded yet');
    }

    if (run.skipped) continue;

    stats.reviewed += 1;

    const defaultKey = run.pass ? 'r' : '';
    const hint = run.pass
      ? '[Enter/r]=record  s=skip  q=quit: '
      : '[Enter]=next  r=record anyway  s=skip  q=quit: ';
    const ans = (await ask(rl, hint)).trim().toLowerCase() || (run.pass ? 'r' : '');

    if (ans === 'q') {
      quit = true;
      stats.quitEarly = true;
      stats.remaining = manifest.phrases.length - stats.reviewed;
      break;
    }
    if (ans === 's') {
      stats.skipped += 1;
      if (run.pass && !inPilot) stats.skippedPassedNew += 1;
      console.log(run.pass && !inPilot
        ? '  → skipped (passed, not in pilot.json — press r next time to record)'
        : '  → skipped');
      continue;
    }

    if (ans === 'r' || (run.pass && ans === '')) {
      const rec = await recordSinglePhrase(run, slug, { corpusDir });
      if (rec.recorded) {
        stats.recorded += 1;
        console.log(`  → recorded [${rec.caseId}] to pilot.json`);
      } else {
        stats.alreadyInPilot += 1;
        console.log(`  → ${rec.reason}`);
      }
    }
  }

  rl.close();

  if (opts.runEval && stats.recorded > 0) {
    const evalReport = await runCorpusEval({ restaurant: slug, corpusDir, llm: false });
    console.log(`\nEval: ${evalReport.passed}/${evalReport.total} passed`);
    if (evalReport.failed > 0) process.exit(1);
  }

  console.log(formatInteractiveSessionSummary(stats));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const corpusDir = DEFAULT_CORPUS_DIR;
  const slug = opts.slug;

  if (opts.init && slug) {
    const { created, path: p } = ensurePhrasesTxtScaffold(slug, { corpusDir });
    console.log(created ? `Created ${p}` : `Already exists: ${p}`);
    console.log('Add one phrase per line, then: npm run intent:harvest -- --restaurant ' + slug);
    if (!opts.interactive && !opts.record) return;
  }

  const resolved = resolveHarvestInput(slug, { corpusDir, filePath: opts.file });
  if (resolved.missing) {
    console.error(`Phrases file not found: ${resolved.inputPath}`);
    console.error(`Run: npm run intent:harvest -- --restaurant ${slug} --init`);
    process.exit(1);
  }

  const manifest = resolved.manifest;
  const runSlug = slug ?? manifest.restaurant;
  if (!runSlug) {
    console.error('Missing restaurant slug');
    process.exit(1);
  }

  console.log(`Reading ${resolved.inputPath} (${manifest.phrases.length} phrases)\n`);

  if (opts.interactive) {
    await runInteractive(manifest, { ...opts, slug: runSlug });
    return;
  }

  const summary = await runHarvestBatch(manifest, {
    slug: runSlug,
    corpusDir,
    businessId: manifest.businessId,
    writeManifest: opts.writeManifest,
    manifestPath: resolved.inputPath,
    record: opts.record,
    candidate: opts.candidate,
    runEval: opts.runEval,
    allowLlm: opts.allowLlm,
  });

  console.log(formatHarvestReport(summary, { verbose: opts.verbose }));

  if (summary.failed > 0 && !opts.record) {
    console.log('\nFix failures, edit phrases.txt, re-run. Or: --interactive to record case-by-case.');
    process.exit(1);
  }
  if (summary.evalReport && summary.evalReport.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
