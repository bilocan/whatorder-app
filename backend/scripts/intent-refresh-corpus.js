#!/usr/bin/env node
/**
 * Refresh expect blocks in a corpus file from current parser + menu fixture output.
 *
 * Usage:
 *   npm run intent:refresh-corpus -- enes-pilot.json
 *   npm run intent:refresh-corpus -- --enes
 */
const { ENES_PILOT_CORPUS_FILE, refreshCorpusExpects } = require('../src/bot/intentEval');

const HELP = `
Refresh corpus expect blocks after menu re-export.

Options:
  --enes            Refresh enes-pilot.json (default when no file given)
  --dry-run         Print summary without writing
  --help, -h        Show this help
`.trim();

function parseArgs(argv) {
  const opts = { file: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--enes') {
      opts.file = ENES_PILOT_CORPUS_FILE;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      opts.file = arg;
    } else {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }
  if (!opts.file) opts.file = ENES_PILOT_CORPUS_FILE;
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { filePath, refreshed } = await refreshCorpusExpects(opts.file, { dryRun: opts.dryRun });

  for (const row of refreshed) {
    console.log(`${row.id}: ${row.outcome}`);
  }
  console.log(`\n${opts.dryRun ? 'Would refresh' : 'Refreshed'} ${refreshed.length} cases → ${filePath}`);
  console.log('Run: npm run intent:eval -- --enes --verbose');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
