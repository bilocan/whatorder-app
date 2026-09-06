const crypto = require('crypto');
const { PassThrough } = require('stream');
const { pipeline } = require('stream/promises');
const archiver = require('archiver');
const unzipper = require('unzipper');

const MAX_ZIP_BYTES = 80 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_ZIP_FILES = 8000;
const MAX_ENTRY_BYTES = 30 * 1024 * 1024;

function checksumJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function checksumBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function zipTooLarge(message) {
  const err = new Error(message);
  err.status = 413;
  return err;
}

function assertZipLimits(buf, directory) {
  if (!buf || buf.length > MAX_ZIP_BYTES) {
    throw zipTooLarge('Restaurant bundle ZIP is too large');
  }
  const files = directory.files || [];
  if (files.length > MAX_ZIP_FILES) {
    throw zipTooLarge('Restaurant bundle ZIP has too many files');
  }
  let uncompressed = 0;
  for (const file of files) {
    const size = Number(file.uncompressedSize) || 0;
    if (size > MAX_ENTRY_BYTES) {
      throw zipTooLarge(`Restaurant bundle file is too large: ${file.path}`);
    }
    uncompressed += size;
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw zipTooLarge('Restaurant bundle uncompressed size is too large');
    }
  }
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
  if (!buf || buf.length > MAX_ZIP_BYTES) {
    throw zipTooLarge('Restaurant bundle ZIP is too large');
  }
  const directory = await unzipper.Open.buffer(buf);
  assertZipLimits(buf, directory);
  const files = {};
  let actualUncompressed = 0;
  for (const file of directory.files) {
    const data = await file.buffer();
    if (data.length > MAX_ENTRY_BYTES) {
      throw zipTooLarge(`Restaurant bundle file is too large: ${file.path}`);
    }
    actualUncompressed += data.length;
    if (actualUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw zipTooLarge('Restaurant bundle uncompressed size is too large');
    }
    files[file.path] = data;
  }
  if (!files['manifest.json']) {
    const err = new Error('ZIP is missing manifest.json');
    err.status = 400;
    throw err;
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
  const assets = [];
  for (const [path, bufFile] of Object.entries(files)) {
    if (!path.startsWith('assets/') || path.endsWith('/')) continue;
    assets.push({
      name: path,
      objectPath: path.slice('assets/'.length),
      buffer: bufFile,
    });
  }
  return { manifest, firestore, assets };
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
  checksumBuffer,
  packBundleToStream,
  packBundleToBuffer,
  unpackBundleFromBuffer,
  countsFromFirestore,
  assertZipLimits,
  MAX_ZIP_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_FILES,
  MAX_ENTRY_BYTES,
};
