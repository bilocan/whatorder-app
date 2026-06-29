#!/usr/bin/env node
/**
 * Export Firestore menu + menuMatch as JSON fixtures for intent corpus eval.
 *
 * Usage:
 *   node src/scripts/exportIntentMenuFixture.js <businessId> [slug]
 *   node src/scripts/exportIntentMenuFixture.js biz_enes_kebap_9450w enes
 *
 * Writes:
 *   fixtures/intent-corpus/restaurants/<slug>/menu.json
 *   fixtures/intent-corpus/restaurants/<slug>/menuMatch.json
 *
 * For first-time setup (menu + empty pilot.json + optional smoke phrases), prefer:
 *   npm run intent:init-restaurant -- <businessId> [slug] --name "Restaurant Name"
 *
 * Requires backend/.env.local or .env.dev with Firebase credentials.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.dev') });

const { slugFromBusinessId } = require('../bot/corpusLayout');
const { exportRestaurantMenuFixture } = require('../bot/restaurantCorpus');

async function main() {
  const [businessId, outSlug] = process.argv.slice(2);
  if (!businessId) {
    console.error('Usage: node src/scripts/exportIntentMenuFixture.js <businessId> [slug]');
    process.exit(1);
  }

  const slug = outSlug || slugFromBusinessId(businessId);
  console.log(`Loading menu for ${businessId} → restaurants/${slug}/`);

  const result = await exportRestaurantMenuFixture(businessId, slug);
  console.log(`Wrote ${result.itemCount} items → ${result.menuPath}`);
  if (result.menuMatchPath) {
    console.log(`Wrote menuMatch → ${result.menuMatchPath}`);
  } else {
    console.log('No menuMatch categories to export (matcher will auto-build from menu names)');
  }

  console.log('\nNext: refresh pilot expects, then eval:');
  console.log(`  npm run intent:refresh-corpus -- --restaurant ${slug}`);
  console.log(`  npm run intent:eval -- --restaurant ${slug} --verbose`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
