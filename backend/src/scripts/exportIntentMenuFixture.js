#!/usr/bin/env node
/**
 * Export Firestore menu + menuMatch as JSON fixtures for intent corpus eval.
 *
 * Usage:
 *   node src/scripts/exportIntentMenuFixture.js <businessId>
 *   node src/scripts/exportIntentMenuFixture.js biz_enes_kebap_9450w
 *
 * Writes:
 *   fixtures/intent-corpus/<slug>-menu.json
 *   fixtures/intent-corpus/<slug>-menuMatch.json  (when stored or built)
 *
 * Requires backend/.env.local or .env.dev with Firebase credentials.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.dev') });

const { getMenuContext } = require('../bot/menuService');

const CORPUS_DIR = path.resolve(__dirname, '../../fixtures/intent-corpus');

function slugFromBusinessId(businessId) {
  return String(businessId)
    .replace(/^biz_/, '')
    .replace(/_[a-z0-9]+$/, '')
    .replace(/_/g, '-')
    .slice(0, 32) || 'tenant';
}

function stripMenuForFixture(items) {
  return items.map((item) => {
    const row = {
      id: item.id,
      name: item.name,
      price: item.price,
      available: item.available !== false,
    };
    if (item.category) row.category = item.category;
    if (item.description) row.description = item.description;
    if (item.aliases?.length) row.aliases = item.aliases;
    if (item.optionGroups?.length) row.optionGroups = item.optionGroups;
    return row;
  });
}

async function main() {
  const [businessId, outSlug] = process.argv.slice(2);
  if (!businessId) {
    console.error('Usage: node src/scripts/exportIntentMenuFixture.js <businessId> [slug]');
    process.exit(1);
  }

  const slug = outSlug || slugFromBusinessId(businessId);
  console.log(`Loading menu for ${businessId}…`);

  const { menu, menuMatch } = await getMenuContext(businessId);
  if (!menu.length) {
    console.error('No available menu items found');
    process.exit(1);
  }

  fs.mkdirSync(CORPUS_DIR, { recursive: true });

  const menuPath = path.join(CORPUS_DIR, `${slug}-menu.json`);
  const menuMatchPath = path.join(CORPUS_DIR, `${slug}-menuMatch.json`);

  const fixtureMenu = stripMenuForFixture(menu);
  fs.writeFileSync(menuPath, `${JSON.stringify(fixtureMenu, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${fixtureMenu.length} items → ${menuPath}`);

  if (menuMatch?.categories && Object.keys(menuMatch.categories).length) {
    fs.writeFileSync(menuMatchPath, `${JSON.stringify(menuMatch, null, 2)}\n`, 'utf8');
    console.log(`Wrote menuMatch → ${menuMatchPath}`);
  } else {
    console.log('No menuMatch categories to export (matcher will auto-build from menu names)');
  }

  console.log('\nNext: refresh enes-pilot expects, then eval:');
  console.log('  npm run intent:refresh-corpus -- --enes');
  console.log('  npm run intent:eval -- --enes --verbose');
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
