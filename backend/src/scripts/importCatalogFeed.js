/**
 * Imports a Meta product feed CSV into a business Firestore menu.
 * Replaces the entire menu: deletes all existing items, then writes CSV rows.
 *
 * Usage:
 *   node src/scripts/importCatalogFeed.js <businessId> <csvFile> [--dry-run]
 *
 * Example:
 *   node src/scripts/importCatalogFeed.js biz_enes_kebap_9450w ./enes-facebook-catalog.csv
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env.local') });
const fs = require('fs');
const path = require('path');
const { admin, db } = require('../lib/firebase');
const { businessRef, menuRef } = require('../lib/collections');
const { buildMenuMatchIndex } = require('../bot/menuMapper');

const BATCH_SIZE = 400;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      row.push(field);
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      if (ch === '\r') i++;
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
  }
  return rows;
}

function parsePrice(raw) {
  const match = String(raw ?? '').match(/([\d.,]+)/);
  if (!match) throw new Error(`Invalid price: "${raw}"`);
  return Number(match[1].replace(',', '.'));
}

function mapCategory(productType) {
  const type = String(productType ?? '').trim();
  if (!type) return 'mains';
  // Use Meta feed product_type so bot/Flow can group by real menu section.
  return type;
}

function csvRowToMenuItem(headers, values) {
  const row = Object.fromEntries(headers.map((h, i) => [h.trim(), values[i] ?? '']));
  const id = row.id?.trim();
  if (!id) throw new Error('Row missing id');

  const now = new Date();
  return {
    id,
    data: {
      name: row.title?.trim() || id,
      description: row.description?.trim() || row.title?.trim() || '',
      price: parsePrice(row.price),
      category: mapCategory(row.product_type),
      photoUrl: row.image_link?.trim() || null,
      available: String(row.availability ?? '').toLowerCase() === 'in stock',
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function clearMenu(businessId) {
  const snap = await menuRef(businessId).get();
  if (snap.empty) return 0;

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    docs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  return docs.length;
}

async function writeMenu(businessId, items) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    items.slice(i, i + BATCH_SIZE).forEach(({ id, data }) => {
      batch.set(menuRef(businessId).doc(id), data);
    });
    await batch.commit();
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--dry-run');
  const dryRun = process.argv.includes('--dry-run');
  const [businessId, csvArg] = args;

  if (!businessId || !csvArg) {
    console.error('Usage: node importCatalogFeed.js <businessId> <csvFile> [--dry-run]');
    process.exit(1);
  }

  const csvPath = path.resolve(csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  if (rows.length < 2) {
    console.error('CSV must have a header row and at least one data row');
    process.exit(1);
  }

  const headers = rows[0];
  const items = rows.slice(1).map(values => csvRowToMenuItem(headers, values));

  console.log(`Business: ${businessId}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Items to import: ${items.length}`);
  if (dryRun) {
    console.log('\nDry run — sample items:');
    items.slice(0, 3).forEach(({ id, data }) => {
      console.log(`  ${id}: ${data.name} — €${data.price.toFixed(2)} (${data.category})`);
    });
    process.exit(0);
  }

  const bizSnap = await businessRef(businessId).get();
  if (!bizSnap.exists) {
    console.error(`Business "${businessId}" not found in Firestore`);
    process.exit(1);
  }
  console.log(`Business found: ${bizSnap.data().name}`);

  const deleted = await clearMenu(businessId);
  console.log(`Deleted ${deleted} existing menu item(s)`);

  await writeMenu(businessId, items);
  console.log(`Imported ${items.length} menu item(s)`);

  const menuItems = items.map(({ id, data }) => ({ ...data, id }));
  const existingMatch = bizSnap.data()?.menuMatch ?? null;
  const menuMatch = buildMenuMatchIndex(menuItems, existingMatch);
  await businessRef(businessId).set({
    menuMatch: {
      ...menuMatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true });
  console.log(`Built menuMatch index (${Object.keys(menuMatch.categories).length} categories)`);
  console.log('Done.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
