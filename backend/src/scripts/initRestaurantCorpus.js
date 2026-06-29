#!/usr/bin/env node
/**
 * One-shot tenant corpus bootstrap: export menu fixture + create pilot.json scaffold.
 *
 * Usage:
 *   npm run intent:init-restaurant -- biz_enes_kebap_9450w enes --name "Enes Kebap"
 *   npm run intent:init-restaurant -- biz_enes_kebap_9450w enes --smoke-categories "Familienpizza,Kebap,Pizza"
 *   npm run intent:init-restaurant -- biz_enes_kebap_9450w enes --record "2 Döner 1 ayran"
 *
 * Requires backend/.env.local or .env.dev with Firebase credentials (menu export).
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.dev') });

const { restaurantPilotPath, slugFromBusinessId } = require('../bot/corpusLayout');
const {
  ensurePilotScaffold,
  exportRestaurantMenuFixture,
  recordPhrasesToPilot,
} = require('../bot/restaurantCorpus');
const { ensurePhrasesTxtScaffold } = require('../bot/intentHarvest');

const HELP = `
Initialize offline intent corpus for a restaurant tenant.

Creates fixtures/intent-corpus/restaurants/<slug>/:
  menu.json       — exported Firestore menu
  menuMatch.json  — category aliases (when stored)
  pilot.json      — empty phrase corpus scaffold (skipped if already exists)

Usage:
  npm run intent:init-restaurant -- <businessId> [slug] [options]

  businessId  Firestore tenant id (bid), e.g. biz_enes_kebap_9450w
  slug        Short corpus folder name you choose, e.g. enes
              (default: guessed from businessId, e.g. enes-kebap — prefer passing explicitly)

Options:
  --name <label>              Restaurant display name in pilot.json
  --smoke-categories <list>   Comma-separated category smoke phrases (Wave A)
  --record <phrase>           Record one phrase into pilot.json (repeatable)
  --tag <name>                Tag for recorded cases (repeatable; default: <slug>_pilot, wave_a)
  --overwrite-pilot           Replace pilot.json scaffold (only when cases array is empty)
  --help, -h                  Show this help

Examples (Enes pilot):
  npm run intent:init-restaurant -- biz_enes_kebap_9450w enes --name "Enes Kebap"
  npm run intent:init-restaurant -- biz_enes_kebap_9450w enes --smoke-categories "Familienpizza,Kebap,Pizza"
  npm run intent:init-restaurant -- biz_enes_kebap_9450w enes --record "2 Döner 1 ayran"

Your next restaurant (swap bid + slug):
  npm run intent:init-restaurant -- biz_YOUR_BID your-slug --name "Restaurant Name"
`.trim();

function parseArgs(argv) {
  const opts = {
    businessId: null,
    slug: null,
    name: null,
    smokeCategories: [],
    recordPhrases: [],
    tags: [],
    overwritePilot: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--name') {
      opts.name = argv[++i];
    } else if (arg === '--smoke-categories') {
      opts.smokeCategories = String(argv[++i])
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else if (arg === '--record') {
      opts.recordPhrases.push(argv[++i]);
    } else if (arg === '--tag') {
      opts.tags.push(argv[++i]);
    } else if (arg === '--overwrite-pilot') {
      opts.overwritePilot = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      if (!opts.businessId) opts.businessId = arg;
      else if (!opts.slug) opts.slug = arg;
      else {
        console.error(`Unexpected argument: ${arg}\n`);
        console.log(HELP);
        process.exit(1);
      }
    } else {
      console.error(`Unknown option: ${arg}\n`);
      console.log(HELP);
      process.exit(1);
    }
  }

  if (!opts.businessId) {
    console.error('Missing <businessId>\n');
    console.log(HELP);
    process.exit(1);
  }

  opts.slug = opts.slug || slugFromBusinessId(opts.businessId);
  return opts;
}

function printNextSteps(slug) {
  console.log('\nNext steps:');
  console.log(`  Fill restaurants/${slug}/phrases.txt → npm run intent:harvest -- --restaurant ${slug} --verbose`);
  console.log(`  npm run intent:record -- --target ${slug} --tag ${slug}_pilot "phrase from seed list"`);
  console.log(`  npm run intent:eval -- --restaurant ${slug} --verbose`);
  console.log('  After menu re-import: npm run intent:export-menu -- <businessId> ' + slug);
  console.log(`  Then: npm run intent:refresh-corpus -- --restaurant ${slug}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slug = opts.slug;

  console.log(`Initializing restaurants/${slug}/ for ${opts.businessId}…`);

  const exportResult = await exportRestaurantMenuFixture(opts.businessId, slug);
  console.log(`Wrote ${exportResult.itemCount} items → ${exportResult.menuPath}`);
  if (exportResult.menuMatchPath) {
    console.log(`Wrote menuMatch → ${exportResult.menuMatchPath}`);
  } else {
    console.log('No menuMatch categories in Firestore (matcher will auto-build from menu names)');
  }

  const pilotPath = restaurantPilotPath(slug);
  let pilotResult;
  if (opts.overwritePilot && fs.existsSync(pilotPath)) {
    const existing = JSON.parse(fs.readFileSync(pilotPath, 'utf8'));
    if (existing.cases?.length) {
      console.error('--overwrite-pilot refused: pilot.json already has cases. Delete cases first or remove flag.');
      process.exit(1);
    }
    pilotResult = ensurePilotScaffold(slug, {
      businessId: opts.businessId,
      restaurantName: opts.name,
      overwrite: true,
    });
  } else {
    pilotResult = ensurePilotScaffold(slug, {
      businessId: opts.businessId,
      restaurantName: opts.name,
    });
  }

  if (pilotResult.created) {
    console.log(`Created pilot scaffold → ${pilotResult.path}`);
  } else {
    console.log(`Pilot corpus already exists → ${pilotResult.path} (${pilotResult.doc.cases?.length ?? 0} cases)`);
  }

  const harvestResult = ensurePhrasesTxtScaffold(slug, { corpusDir: undefined });
  if (harvestResult.created) {
    console.log(`Created phrases worksheet → ${harvestResult.path}`);
  } else {
    console.log(`Phrases worksheet already exists → ${harvestResult.path}`);
  }

  const phrasesToRecord = [
    ...opts.smokeCategories,
    ...opts.recordPhrases,
  ];
  if (phrasesToRecord.length) {
    const tags = opts.tags.length
      ? [...opts.tags, `${slug}_pilot`]
      : [`${slug}_pilot`, 'wave_a', ...(opts.smokeCategories.length ? ['category_smoke'] : [])];
    const recorded = await recordPhrasesToPilot(slug, phrasesToRecord, {
      businessId: opts.businessId,
      tags,
      notes: opts.name ? `init-restaurant: ${opts.name}` : 'init-restaurant',
    });
    for (const row of recorded) {
      console.log(`Recorded [${row.id}] → ${row.filePath}`);
    }
    console.log(`\nEval: npm run intent:eval -- --restaurant ${slug} --verbose`);
  } else {
    printNextSteps(slug);
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
