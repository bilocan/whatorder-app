#!/usr/bin/env node
/**
 * Record a sandbox run as a corpus case (snapshot of current behavior).
 *
 * Usage:
 *   npm run intent:record -- "zwei döner einer mit allem"
 *   npm run intent:record -- --id my-case --tag modifier "phrase"
 *   npm run intent:record -- --target builtin --append "phrase"
 *   npm run intent:record -- --stdout "phrase"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const fs = require('fs');
const path = require('path');
const { BUILTIN_MENU } = require('../src/bot/intentSandbox');
const { getMenu } = require('../src/bot/menuService');
const {
  appendCaseToCorpus,
  formatEvalReport,
  recordIntentCase,
  runCase,
} = require('../src/bot/intentEval');
const { buildMenuMatchIndex } = require('../src/bot/menuMapper');
const {
  corpusFilePath,
  isRestaurantTarget,
  restaurantMenuMatchPath,
  restaurantMenuPath,
} = require('../src/bot/corpusLayout');

const HELP = `
Intent record — run phrase through sandbox and draft a corpus case.

Default: append to fixtures/intent-corpus/candidate.json with status "candidate".
The expect block snapshots CURRENT behavior — edit it to state desired behavior before promoting.

Options:
  --id <slug>           Case id (default: slug from phrase)
  --tag <name>          Tag (repeatable)
  --target candidate|builtin|enes|<slug>   Corpus file (default: candidate; slug → restaurants/<slug>/pilot.json)
  --append              Write to corpus file (default when not --stdout)
  --stdout              Print case JSON only, do not write file
  --notes <text>        Free-form note on the case
  --verify              Run expect assertions after record (exit 1 if snapshot fails)
  --business <id>       Firestore menu (needs .env.local)
  --menu <path>         Menu JSON file
  --lang de|en|tr       Locale (default: de)
  --llm                 Enable LLM paths
  --help, -h            Show this help

Promote workflow:
  1. npm run intent:record -- "missed phrase from logs"
  2. Edit candidate.json expect → desired outcome (or fix parser first)
  3. npm run intent:eval -- --file candidate.json
  4. Move case to builtin.json, remove status, drop "candidate" tag
  5. npm run intent:eval  (CI gate)
`.trim();

function parseArgs(argv) {
  const opts = {
    id: null,
    tags: [],
    target: 'candidate',
    append: true,
    stdout: false,
    notes: null,
    verify: false,
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
    } else if (arg === '--target') {
      opts.target = argv[++i];
    } else if (arg === '--append') {
      opts.append = true;
      opts.stdout = false;
    } else if (arg === '--stdout') {
      opts.stdout = true;
      opts.append = false;
    } else if (arg === '--notes') {
      opts.notes = argv[++i];
    } else if (arg === '--verify') {
      opts.verify = true;
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

  if (!opts.phrases.length) {
    console.error('Missing phrase. Pass customer text as the last argument.\n');
    console.log(HELP);
    process.exit(1);
  }
  if (!['candidate', 'builtin'].includes(opts.target) && !isRestaurantTarget(opts.target)) {
    console.error('--target must be candidate, builtin, or a restaurant slug (e.g. enes)');
    process.exit(1);
  }
  return opts;
}

function loadMenuFromFile(filePath) {
  const abs = path.resolve(filePath);
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`Menu file must be a JSON array: ${abs}`);
  }
  return data;
}

function loadMenuMatchForRestaurant(slug) {
  const matchPath = restaurantMenuMatchPath(slug);
  if (!fs.existsSync(matchPath)) return null;
  const stored = JSON.parse(fs.readFileSync(matchPath, 'utf8'));
  return stored && typeof stored === 'object' ? stored : null;
}

async function resolveMenu(opts) {
  if (opts.menuPath) {
    return { menu: loadMenuFromFile(opts.menuPath), menuRef: path.basename(opts.menuPath) };
  }
  if (isRestaurantTarget(opts.target)) {
    const slug = opts.target === 'enes' ? 'enes' : opts.target;
    const menuPath = restaurantMenuPath(slug);
    const menu = loadMenuFromFile(menuPath);
    const storedMatch = loadMenuMatchForRestaurant(slug);
    const menuMatch = storedMatch ? buildMenuMatchIndex(menu, storedMatch) : null;
    return { menu, menuMatch, menuRef: 'menu.json', restaurantSlug: slug };
  }
  if (opts.businessId) {
    const menu = await getMenu(opts.businessId);
    return { menu, menuRef: `firestore:${opts.businessId}` };
  }
  return { menu: BUILTIN_MENU, menuRef: 'builtin' };
}

function suiteMetaForTarget(target) {
  if (!isRestaurantTarget(target)) return null;
  return { menu: 'menu.json', menuMatch: 'menuMatch.json' };
}

async function recordPhrase(text, ctx) {
  const { result, caseDef } = await recordIntentCase(text, {
    menu: ctx.menu,
    menuMatch: ctx.menuMatch ?? undefined,
    lang: ctx.opts.lang,
    businessId: ctx.opts.businessId,
    llm: ctx.opts.llm,
  }, {
    id: ctx.opts.id,
    tags: ctx.opts.tags,
    status: ctx.opts.target === 'candidate' ? 'candidate' : 'shipped',
    menu: ctx.menuRef === 'builtin' ? 'builtin' : ctx.menuRef,
    lang: ctx.opts.lang,
    notes: ctx.opts.notes,
    source: ctx.menuRef,
    target: ctx.opts.target,
  });

  if (ctx.opts.stdout) {
    console.log(JSON.stringify(caseDef, null, 2));
    return { caseDef, written: false };
  }

  if (ctx.opts.append) {
    const { filePath, total } = appendCaseToCorpus(caseDef, { target: ctx.opts.target });
    console.log(`Recorded [${caseDef.id}] → ${filePath} (${total} cases)`);
    console.log(`  outcome: ${result.outcome}, parsedBy: ${result.intent?.parsedBy ?? '—'}`);
    if (caseDef.status === 'candidate') {
      console.log('  Edit expect in candidate.json if current behavior is wrong, then fix parser.');
    } else if (isRestaurantTarget(ctx.opts.target)) {
      console.log(`  Run: npm run intent:eval -- --restaurant ${ctx.opts.target === 'enes' ? 'enes' : ctx.opts.target}`);
    }
  }

  if (ctx.opts.verify) {
    const suiteMeta = suiteMetaForTarget(ctx.opts.target);
    const corpusBaseDir = isRestaurantTarget(ctx.opts.target)
      ? path.dirname(corpusFilePath(ctx.opts.target))
      : null;
    const run = await runCase(
      suiteMeta
        ? { ...caseDef, _suiteMeta: suiteMeta, _corpusBaseDir: corpusBaseDir }
        : caseDef,
      { llm: ctx.opts.llm },
    );
    if (!run.pass) {
      console.error(formatEvalReport({
        total: 1,
        passed: 0,
        failed: 1,
        runs: [run],
        failures: [run],
      }, { verbose: true }));
      process.exit(1);
    }
  }

  return { caseDef, written: ctx.opts.append };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { menu, menuMatch, menuRef } = await resolveMenu(opts);
  const ctx = { menu, menuMatch, menuRef, opts };

  for (const phrase of opts.phrases) {
    await recordPhrase(phrase, ctx);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
