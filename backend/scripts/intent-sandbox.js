#!/usr/bin/env node
/**
 * Intent sandbox — type customer text, see parse + menu match + bot reply preview.
 *
 * Usage:
 *   npm run intent:sandbox -- "2 Döner 1 ayran"
 *   npm run intent:sandbox -- --interactive
 *   npm run intent:sandbox -- --business biz_test "zwei döner einer mit allem"
 *   npm run intent:sandbox -- --llm --business biz_test "was für mich ein hühner döner"
 *   npm run intent:sandbox -- --menu ./fixtures/menu.json "pizza und cola"
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { BUILTIN_MENU, evaluateIntent, formatSandboxResult } = require('../src/bot/intentSandbox');
const { getMenuContext } = require('../src/bot/menuService');
const { buildMenuMatchIndex } = require('../src/bot/menuMapper');

const HELP = `
Intent sandbox — test parse → match → bot reply without WhatsApp or sessions.

Options:
  --interactive, -i     REPL loop (default when no phrase given)
  --business <id>       Load menu from Firestore (needs .env.local + Firebase)
  --menu <path>         Load menu from JSON file [{ id, name, price, ... }]
  --llm                 Enable LLM paths (needs AI_INTENT_ENABLED + GEMINI_API_KEY)
  --lang <de|en|tr>     Locale for bot reply text (default: de)
  --json                Print raw result JSON instead of formatted text
  --basket-ops          Parse committed-basket mutation ops (Tier 5 / basketOps.js)
  --basket <json>       Basket snapshot JSON array, e.g. '[{"name":"Döner","qty":1,"price":8.5}]'

Interactive commands:
  :q / :quit            Exit
  :menu                 List loaded menu items
  :llm on|off           Toggle LLM retry (or start with --llm)
  :help                 Show this help
`.trim();

function parseArgs(argv) {
  const opts = {
    interactive: false,
    businessId: null,
    menuPath: null,
    llm: false,
    lang: 'de',
    json: false,
    basketOps: false,
    basket: [],
    phrases: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--interactive' || arg === '-i') {
      opts.interactive = true;
    } else if (arg === '--business') {
      opts.businessId = argv[++i];
    } else if (arg === '--menu') {
      opts.menuPath = argv[++i];
    } else if (arg === '--llm') {
      opts.llm = true;
    } else if (arg === '--lang') {
      opts.lang = argv[++i];
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--basket-ops') {
      opts.basketOps = true;
    } else if (arg === '--basket') {
      opts.basket = JSON.parse(argv[++i]);
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

  if (!opts.phrases.length && !opts.interactive) {
    opts.interactive = true;
  }
  return opts;
}

function loadMenuFromFile(filePath) {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error(`Menu file must be a JSON array: ${abs}`);
  }
  return data;
}

async function resolveMenu(opts) {
  if (opts.menuPath) {
    const menu = loadMenuFromFile(opts.menuPath);
    return { menu, menuMatch: buildMenuMatchIndex(menu), source: `file:${opts.menuPath}` };
  }
  if (opts.businessId) {
    const { menu, menuMatch } = await getMenuContext(opts.businessId);
    return { menu, menuMatch, source: `firestore:${opts.businessId}` };
  }
  const menu = BUILTIN_MENU;
  return { menu, menuMatch: buildMenuMatchIndex(menu), source: 'builtin' };
}

function printResult(result, opts) {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatSandboxResult(result));
}

function llmStatus(opts) {
  if (!opts.llm) return 'rules + learned cache only';
  if (process.env.AI_INTENT_ENABLED !== 'true') {
    return 'LLM requested but AI_INTENT_ENABLED is not true';
  }
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    return 'LLM requested but no GEMINI_API_KEY or OPENAI_API_KEY';
  }
  return 'LLM enabled';
}

async function runPhrase(text, ctx) {
  const result = await evaluateIntent(text, {
    menu: ctx.menu,
    menuMatch: ctx.menuMatch,
    lang: ctx.opts.lang,
    businessId: ctx.opts.businessId,
    llm: ctx.opts.llm,
    basket: ctx.opts.basket ?? [],
    basketOps: ctx.opts.basketOps,
  });
  printResult(result, ctx.opts);
}

async function runInteractive(ctx) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => {
    rl.question('> ', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        prompt();
        return;
      }
      if (trimmed === ':q' || trimmed === ':quit') {
        rl.close();
        return;
      }
      if (trimmed === ':help') {
        console.log(HELP);
        prompt();
        return;
      }
      if (trimmed === ':menu') {
        for (const item of ctx.menu) {
          console.log(`  • ${item.name} — €${Number(item.price).toFixed(2)} (${item.id})`);
        }
        prompt();
        return;
      }
      if (trimmed === ':llm on' || trimmed === ':llm off') {
        ctx.opts.llm = trimmed.endsWith('on');
        console.log(llmStatus(ctx.opts));
        prompt();
        return;
      }

      try {
        await runPhrase(trimmed, ctx);
      } catch (err) {
        console.error(`Error: ${err.message}`);
      }
      prompt();
    });
  };

  console.log(`Intent sandbox — menu: ${ctx.source} (${ctx.menu.length} items), ${llmStatus(ctx.opts)}`);
  console.log('Type a customer phrase, :menu, or :q to quit.\n');
  prompt();

  await new Promise(resolve => rl.on('close', resolve));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { menu, menuMatch, source } = await resolveMenu(opts);
  const ctx = { menu, menuMatch, source, opts };

  if (opts.llm) {
    const status = llmStatus(opts);
    if (status.includes('not true') || status.includes('no GEMINI')) {
      console.warn(`Warning: ${status}`);
    }
  }

  if (opts.interactive) {
    await runInteractive(ctx);
    return;
  }

  for (const phrase of opts.phrases) {
    await runPhrase(phrase, ctx);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
