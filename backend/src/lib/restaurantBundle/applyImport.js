const { storesForProfile } = require('./stores');
const { sanitizeBusinessDoc, sanitizeOrder, isSameEnv } = require('./sanitize');
const { assertNameConfirm } = require('./confirm');
const { coverStorageRef, isDataUri, rewriteStorageHost, rewriteDocUrls, rewriteBusinessIdInPath, parseGsUrl } = require('./urls');

const SETUP_SUBCOLS = [
  'menu', 'optionGroups', 'deals', 'intentLearnings', 'seededIntents',
];

const FULL_SUBCOLS = ['orders', 'customers', 'receipts'];

function emptyTenant() {
  return {
    business: null,
    menu: {},
    optionGroups: {},
    deals: {},
    intentLearnings: {},
    seededIntents: {},
    seedOverrides: null,
    orders: {},
    customers: {},
    receipts: {},
    receiptCounter: null,
    owners: [],
  };
}

function cloneMap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = { ...v };
  return out;
}

function applyUrlRewrite(doc, { sourceHost, targetHost, sourceId, targetId }) {
  if (!doc) return doc;
  let next = { ...doc };
  if (sourceHost && targetHost) {
    next = rewriteDocUrls(next, (url) => rewriteStorageHost(url, { sourceHost, targetHost }));
  }
  if (sourceId && targetId && sourceId !== targetId) {
    next = rewriteDocUrls(next, (url) => rewriteBusinessIdInPath(url, sourceId, targetId));
    if (next.gcsPath) next.gcsPath = rewriteBusinessIdInPath(next.gcsPath, sourceId, targetId);
  }
  return next;
}

function applyImport({ bundle, existing = emptyTenant(), options = {}, targetEnv }) {
  const profile = bundle?.manifest?.profile;
  storesForProfile(profile);
  if (bundle.manifest.schemaVersion !== 1) {
    const err = new Error(`Unsupported schemaVersion: ${bundle.manifest.schemaVersion}`);
    err.status = 400;
    throw err;
  }

  const sourceId = bundle.manifest.businessId;
  const targetId = options.keepBusinessId === false
    ? options.newBusinessId
    : sourceId;
  if (!targetId) {
    const err = new Error('Target businessId is required');
    err.status = 400;
    throw err;
  }

  const incomingBusiness = bundle.firestore?.business || {};
  const businessName = incomingBusiness.name || bundle.manifest.businessName;

  assertNameConfirm({
    confirmName: options.confirmName,
    businessName,
    targetBusinessId: targetId,
    isProduction: options.isProduction,
  });

  const collision = Boolean(existing.business);
  if (collision && !options.overwrite) {
    const err = new Error('Restaurant already exists; pass overwrite: true');
    err.status = 409;
    throw err;
  }

  const source = bundle.manifest.source || {};
  const next = {
    business: null,
    menu: cloneMap(existing.menu),
    optionGroups: cloneMap(existing.optionGroups),
    deals: cloneMap(existing.deals),
    intentLearnings: cloneMap(existing.intentLearnings),
    seededIntents: cloneMap(existing.seededIntents),
    seedOverrides: existing.seedOverrides ? { ...existing.seedOverrides } : null,
    orders: cloneMap(existing.orders),
    customers: cloneMap(existing.customers),
    receipts: cloneMap(existing.receipts),
    receiptCounter: existing.receiptCounter ? { ...existing.receiptCounter } : null,
    owners: [...(existing.owners || [])],
    routingWrites: [],
    deleted: { menu: [], optionGroups: [], deals: [], intentLearnings: [], seededIntents: [], orders: [], customers: [], receipts: [] },
    storageDownloads: [],
    skippedDataUriCover: false,
  };

  const sourceHost = source.storageBucket || '';
  const targetHost = targetEnv?.storageBucket || '';
  const rewriteOpts = {
    sourceHost,
    targetHost,
    sourceId,
    targetId,
  };

  if (options.overwrite) {
    for (const col of SETUP_SUBCOLS) {
      next.deleted[col] = Object.keys(next[col]);
      next[col] = {};
    }
    next.seedOverrides = null;
    if (profile === 'full') {
      for (const col of FULL_SUBCOLS) {
        next.deleted[col] = Object.keys(next[col]);
        next[col] = {};
      }
      next.receiptCounter = null;
    }
  }

  let business = sanitizeBusinessDoc(
    { ...incomingBusiness, id: targetId },
    { profile, source, target: targetEnv },
  );
  business = applyUrlRewrite(business, rewriteOpts);

  const coverUrl = incomingBusiness.imageUrl;
  if (isDataUri(coverUrl)) {
    next.skippedDataUriCover = true;
    delete business.imageUrl;
  } else {
    const ref = coverStorageRef(coverUrl);
    if (ref) {
      next.storageDownloads.push({ kind: 'cover', ...ref, originalUrl: coverUrl });
    }
  }

  next.business = business;

  const copyCol = (name, sanitizeDoc) => {
    const incoming = bundle.firestore?.[name] || {};
    for (const [id, doc] of Object.entries(incoming)) {
      let data = { ...doc };
      if (sanitizeDoc) data = sanitizeDoc(data);
      next[name][id] = applyUrlRewrite(data, rewriteOpts);
    }
  };

  copyCol('menu');
  copyCol('optionGroups');
  copyCol('deals');
  copyCol('intentLearnings');
  copyCol('seededIntents');
  if (bundle.firestore?.seedOverrides) {
    next.seedOverrides = { ...bundle.firestore.seedOverrides };
  }

  for (const doc of Object.values(bundle.firestore?.menu || {})) {
    const ref = parseGsUrl(doc.photoUrl);
    if (ref) next.storageDownloads.push({ kind: 'menu', ...ref, originalUrl: doc.photoUrl });
  }

  if (profile === 'full') {
    copyCol('orders', (doc) => sanitizeOrder(doc, { profile, source, target: targetEnv }));
    copyCol('customers');
    copyCol('receipts');
    if (bundle.firestore?.receiptCounter) {
      next.receiptCounter = { ...bundle.firestore.receiptCounter };
    }
  }

  const ownerPhones = bundle.firestore?.owners || [];
  next.owners = ownerPhones.map((o) => ({ phone: o.phone })).filter((o) => o.phone);

  const tamperedRouting = bundle.firestore?.phoneRouting;
  if (tamperedRouting && !options.attachToPhoneLine) {
    next.routingWrites = [];
  }
  if (options.attachToPhoneLine && options.targetPhoneNumberId) {
    next.routingWrites.push({
      phoneNumberId: options.targetPhoneNumberId,
      op: 'arrayUnion',
      businessId: targetId,
      preserveDefaultBusinessId: true,
    });
  }

  next.targetBusinessId = targetId;
  next.sameEnv = isSameEnv(source, targetEnv);
  return next;
}

module.exports = {
  applyImport,
  emptyTenant,
};
