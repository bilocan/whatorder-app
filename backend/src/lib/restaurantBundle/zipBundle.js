const crypto = require('crypto');
const { PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');
const unzipper = require('unzipper');

function checksumJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function packBundleToStream(bundle, output) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const done = pipeline(archive, output);
  archive.append(JSON.stringify(bundle.manifest, null, 2), { name: 'manifest.json' });
  const fs = bundle.firestore || {};
  archive.append(JSON.stringify(fs.business || {}, null, 2), { name: 'firestore/business.json' });
  for (const col of ['menu', 'optionGroups', 'deals', 'intentLearnings', 'seededIntents', 'orders', 'customers', 'receipts']) {
    for (const [id, doc] of Object.entries(fs[col] || {})) {
      archive.append(JSON.stringify(doc), { name: `firestore/${col}/${id}.json` });
    }
  }
  if (fs.seedOverrides) {
    archive.append(JSON.stringify(fs.seedOverrides), { name: 'firestore/config/seedOverrides.json' });
  }
  if (fs.receiptCounter) {
    archive.append(JSON.stringify(fs.receiptCounter), { name: 'firestore/counters/receipts.json' });
  }
  if (fs.owners) {
    archive.append(JSON.stringify(fs.owners), { name: 'firestore/owners.json' });
  }
  for (const asset of bundle.assets || []) {
    archive.append(asset.buffer, { name: asset.name });
  }
  await archive.finalize();
  await done;
  return archive;
}

async function packBundleToBuffer(bundle) {
  const chunks = [];
  const sink = new PassThrough();
  sink.on('data', (c) => chunks.push(c));
  await packBundleToStream(bundle, sink);
  return Buffer.concat(chunks);
}

async function unpackBundleFromBuffer(buf) {
  const directory = await unzipper.Open.buffer(buf);
  const files = {};
  for (const file of directory.files) {
    files[file.path] = await file.buffer();
  }
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  const firestore = {
    business: files['firestore/business.json']
      ? JSON.parse(files['firestore/business.json'].toString('utf8'))
      : {},
    menu: {},
    optionGroups: {},
    deals: {},
    intentLearnings: {},
    seededIntents: {},
    orders: {},
    customers: {},
    receipts: {},
    owners: files['firestore/owners.json']
      ? JSON.parse(files['firestore/owners.json'].toString('utf8'))
      : [],
  };
  for (const [path, bufFile] of Object.entries(files)) {
    const m = path.match(/^firestore\/(menu|optionGroups|deals|intentLearnings|seededIntents|orders|customers|receipts)\/(.+)\.json$/);
    if (m) firestore[m[1]][m[2]] = JSON.parse(bufFile.toString('utf8'));
  }
  if (files['firestore/config/seedOverrides.json']) {
    firestore.seedOverrides = JSON.parse(files['firestore/config/seedOverrides.json'].toString('utf8'));
  }
  if (files['firestore/counters/receipts.json']) {
    firestore.receiptCounter = JSON.parse(files['firestore/counters/receipts.json'].toString('utf8'));
  }
  return { manifest, firestore };
}

function countsFromFirestore(fs, profile) {
  const countMap = (obj) => Object.keys(obj || {}).length;
  const counts = {
    menu: countMap(fs.menu),
    optionGroups: countMap(fs.optionGroups),
    deals: countMap(fs.deals),
    intentLearnings: countMap(fs.intentLearnings),
    owners: (fs.owners || []).length,
  };
  if (profile === 'full') {
    counts.orders = countMap(fs.orders);
    counts.customers = countMap(fs.customers);
    counts.receipts = countMap(fs.receipts);
  }
  return counts;
}

module.exports = {
  checksumJson,
  packBundleToStream,
  packBundleToBuffer,
  unpackBundleFromBuffer,
  countsFromFirestore,
};
