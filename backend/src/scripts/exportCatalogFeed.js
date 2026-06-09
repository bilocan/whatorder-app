/**
 * Exports a business's Firestore menu as a Meta product feed CSV.
 *
 * Upload the output file in Meta Commerce Manager:
 *   Catalog → Items → Add Items → Use Data Feed → Upload File
 *
 * Re-run and re-upload whenever the menu changes.
 *
 * Usage:
 *   node src/scripts/exportCatalogFeed.js <businessId> [outputFile]
 *
 * Example:
 *   node src/scripts/exportCatalogFeed.js biz_test catalog-feed.csv
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.dev') });
const fs   = require('fs');
const path = require('path');
const { db } = require('../lib/firebase');

const DEFAULT_IMAGE = process.env.CATALOG_DEFAULT_IMAGE_URL || 'https://whatorder.app/placeholder.png';
const PRODUCT_URL   = process.env.CATALOG_PRODUCT_URL       || 'https://whatorder.app';

// Meta required CSV columns
const HEADERS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];

function csvRow(values) {
  return values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}

async function main() {
  const [businessId, outputArg] = process.argv.slice(2);
  if (!businessId) {
    console.error('Usage: node exportCatalogFeed.js <businessId> [outputFile]');
    process.exit(1);
  }

  console.log('Connecting to Firestore...');
  const bizSnap = await db.collection('businesses').doc(businessId).get();
  if (!bizSnap.exists) {
    console.error(`Business "${businessId}" not found in Firestore`);
    process.exit(1);
  }
  const biz = bizSnap.data();
  console.log(`Business found: ${biz.name}`);

  const menuSnap = await db
    .collection('businesses').doc(businessId)
    .collection('menu')
    .where('available', '==', true)
    .get();

  if (menuSnap.empty) {
    console.error('No available menu items found');
    process.exit(1);
  }
  console.log(`Found ${menuSnap.size} menu items`);

  const rows = [csvRow(HEADERS)];

  for (const doc of menuSnap.docs) {
    const item = { id: doc.id, ...doc.data() };
    rows.push(csvRow([
      item.id,
      item.name,
      item.description || item.name,
      'in stock',
      'new',
      `${Number(item.price).toFixed(2)} EUR`,
      PRODUCT_URL,
      item.imageUrl || DEFAULT_IMAGE,
      biz.name || 'WhatOrder',
    ]));
  }

  const csv = rows.join('\n');
  const outFile = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : path.resolve(process.cwd(), `catalog-feed-${businessId}.csv`);

  console.log(`Writing to: ${outFile}`);
  fs.writeFileSync(outFile, csv, 'utf8');
  console.log(`✅ Exported ${menuSnap.size} items → ${outFile}`);
  console.log('\nUpload in Commerce Manager: Catalog → Items → Add Items → Use Data Feed → Upload File');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
