/** @typedef {{ id: string, data: Record<string, unknown> }} AuditDoc */

/** Protected test/pilot restaurants — never suggest deleting these. */
const PROTECTED_BUSINESS_IDS = new Set(['biz_enes_kebap_9450w']);

const VALID_ORDER_STATUSES = new Set([
  'pending',
  'approved',
  'preparing',
  'ready',
  'picked_up',
  'on_the_way',
  'delivered',
  'rejected',
  'cancelled',
  'completed', // legacy
]);

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  return null;
}

/**
 * @param {AuditDoc} order
 * @returns {string[]}
 */
function checkOrder(order) {
  const issues = [];
  const { id, data } = order;

  if (!data.status) {
    issues.push(`orders/${id}: missing status`);
  } else if (!VALID_ORDER_STATUSES.has(String(data.status))) {
    issues.push(`orders/${id}: invalid status "${data.status}"`);
  }

  if (!Array.isArray(data.items) || data.items.length === 0) {
    issues.push(`orders/${id}: missing or empty items`);
  } else {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item || typeof item !== 'object') {
        issues.push(`orders/${id}: items[${i}] is not an object`);
        continue;
      }
      if (!item.name) issues.push(`orders/${id}: items[${i}] missing name`);
      if (item.qty == null) issues.push(`orders/${id}: items[${i}] missing qty`);
      if (item.price == null) issues.push(`orders/${id}: items[${i}] missing price`);
    }
  }

  if (data.total == null) issues.push(`orders/${id}: missing total`);
  if (!parseTimestamp(data.createdAt)) issues.push(`orders/${id}: missing or invalid createdAt`);

  return issues;
}

/**
 * @param {string[]} routingBusinessIds
 * @param {string[]} allBusinessIds
 * @returns {{ routingMissingBusiness: string[], orphanBusinesses: string[], protectedOrphans: string[] }}
 */
function checkBusinessRouting(routingBusinessIds, allBusinessIds) {
  const routingSet = new Set(routingBusinessIds);
  const allSet = new Set(allBusinessIds);

  const routingMissingBusiness = routingBusinessIds.filter((id) => !allSet.has(id));

  const orphanBusinesses = [];
  const protectedOrphans = [];
  for (const id of allBusinessIds) {
    if (routingSet.has(id)) continue;
    if (PROTECTED_BUSINESS_IDS.has(id)) {
      protectedOrphans.push(id);
    } else {
      orphanBusinesses.push(id);
    }
  }

  return { routingMissingBusiness, orphanBusinesses, protectedOrphans };
}

/**
 * @param {AuditDoc} session
 * @param {Set<string>} businessIds
 * @returns {string[]}
 */
function checkSession(session, businessIds) {
  const issues = [];
  const { id, data } = session;
  const bid = data.businessId;

  if (bid == null || bid === '') return issues;

  if (!businessIds.has(String(bid))) {
    issues.push(`sessions/${id}: businessId "${bid}" does not exist`);
  }

  if (!parseTimestamp(data.updatedAt)) {
    issues.push(`sessions/${id}: missing or invalid updatedAt`);
  }

  return issues;
}

/**
 * Normalize menu item name for intentLearning cross-check.
 * @param {string} name
 */
function normalizeMenuName(name) {
  return String(name).trim().toLowerCase();
}

/**
 * @param {AuditDoc} learning
 * @param {Set<string>} menuNames
 * @param {string} [collection] — intentLearnings (live) or seededIntents (release archive)
 * @returns {string[]}
 */
function checkIntentLearning(learning, menuNames, collection = 'intentLearnings') {
  const issues = [];
  const { id, data } = learning;
  const items = data.items;

  if (!Array.isArray(items)) {
    issues.push(`${collection}/${id}: missing items array`);
    return issues;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item?.name) continue;
    const key = normalizeMenuName(item.name);
    if (!menuNames.has(key)) {
      issues.push(`${collection}/${id}: items[${i}] name "${item.name}" not in menu`);
    }
  }

  return issues;
}

/**
 * Count orders per customer using normalized phone (digits only), matching orderService keys.
 * @param {AuditDoc[]} orderDocs
 * @param {(phone: unknown) => string} normalizePhone
 * @returns {Map<string, number>}
 */
function countOrdersByCustomer(orderDocs, normalizePhone) {
  const map = new Map();
  for (const order of orderDocs) {
    const raw = order.data.customerId ?? order.data.customerPhone ?? '';
    const key = normalizePhone(raw);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/**
 * Normalize owner phone the same way as POST /admin/owners (E.164).
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeOwnerPhone(raw) {
  if (raw == null || raw === '') return null;
  const stripped = String(raw).replace(/[\s\-().]/g, '');
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

/**
 * Resolve restaurants an owner doc grants access to (businessIds wins; legacy businessId fallback).
 * @param {Record<string, unknown>} data
 * @returns {string[]}
 */
function getOwnerBusinessIds(data) {
  const fromArray = Array.isArray(data.businessIds)
    ? data.businessIds.map(String).filter(Boolean)
    : [];
  if (fromArray.length > 0) return fromArray;
  return data.businessId ? [String(data.businessId)] : [];
}

/**
 * @typedef {{ exists: boolean, phone: string | null }} OwnerAuthInfo
 */

/**
 * @param {AuditDoc} owner
 * @param {{ auth: OwnerAuthInfo, businessIdSet: Set<string> }} ctx
 * @returns {string[]}
 */
function checkOwnerDoc(owner, { auth, businessIdSet }) {
  const issues = [];
  const { id: uid, data } = owner;

  if (!auth.exists) {
    issues.push(`owners/${uid}: no Firebase Auth user (orphan owner doc)`);
    return issues;
  }

  const docPhone = normalizeOwnerPhone(data.phone);
  const authPhone = auth.phone ? normalizeOwnerPhone(auth.phone) : null;

  if (docPhone && authPhone && docPhone !== authPhone) {
    issues.push(
      `owners/${uid}: stored phone ${docPhone} ≠ Auth phone ${authPhone} (dashboard login uses Auth)`,
    );
  }

  const ids = getOwnerBusinessIds(data);
  if (ids.length === 0) {
    issues.push(`owners/${uid}: no businessId or businessIds`);
  }

  const legacyId = data.businessId ? String(data.businessId) : null;
  const idsArray = Array.isArray(data.businessIds)
    ? data.businessIds.map(String).filter(Boolean)
    : null;

  if (legacyId && idsArray && idsArray.length > 0 && !idsArray.includes(legacyId)) {
    issues.push(`owners/${uid}: businessId ${legacyId} not in businessIds array`);
  }

  if (legacyId && !idsArray) {
    issues.push(`owners/${uid}: legacy businessId only (missing businessIds array)`);
  }

  for (const bid of ids) {
    if (!businessIdSet.has(bid)) {
      issues.push(`owners/${uid}: references missing business "${bid}"`);
    }
  }

  return issues;
}

/**
 * Flag businesses with no owner doc linking them (dashboard login unavailable).
 * @param {string[]} allBusinessIds
 * @param {AuditDoc[]} ownerDocs
 * @returns {string[]}
 */
function checkBusinessesWithoutOwner(allBusinessIds, ownerDocs) {
  const covered = new Set();
  for (const doc of ownerDocs) {
    for (const id of getOwnerBusinessIds(doc.data)) covered.add(id);
  }

  const issues = [];
  for (const id of allBusinessIds) {
    if (!covered.has(id)) {
      issues.push(`businesses/${id}: no owner linked (dashboard login unavailable)`);
    }
  }
  return issues;
}

/**
 * Same phone stored on multiple owner docs — only the Auth-matching UID can log in.
 * @param {AuditDoc[]} ownerDocs
 * @returns {string[]}
 */
function checkDuplicateOwnerPhones(ownerDocs) {
  /** @type {Map<string, string[]>} */
  const byDocPhone = new Map();
  const issues = [];

  for (const doc of ownerDocs) {
    const phone = normalizeOwnerPhone(doc.data.phone);
    if (!phone) continue;
    const list = byDocPhone.get(phone) ?? [];
    list.push(doc.id);
    byDocPhone.set(phone, list);
  }

  for (const [phone, uids] of byDocPhone) {
    if (uids.length > 1) {
      issues.push(
        `owners: phone ${phone} on ${uids.length} docs (${uids.join(', ')}) — login resolves to one Auth UID`,
      );
    }
  }

  return issues;
}

/**
 * @param {AuditDoc} customer
 * @param {number} actualOrderCount
 * @returns {string[]}
 */
function checkCustomerAggregates(customer, actualOrderCount) {
  const issues = [];
  const { id, data } = customer;
  const stored = data.orderCount;

  if (stored == null) {
    issues.push(`customers/${id}: missing orderCount`);
    return issues;
  }

  if (Number(stored) !== actualOrderCount) {
    issues.push(
      `customers/${id}: orderCount=${stored} but ${actualOrderCount} orders with customerId/phone match`,
    );
  }

  return issues;
}

module.exports = {
  PROTECTED_BUSINESS_IDS,
  VALID_ORDER_STATUSES,
  parseTimestamp,
  checkOrder,
  checkBusinessRouting,
  checkSession,
  checkIntentLearning,
  checkCustomerAggregates,
  countOrdersByCustomer,
  normalizeMenuName,
  normalizeOwnerPhone,
  getOwnerBusinessIds,
  checkOwnerDoc,
  checkBusinessesWithoutOwner,
  checkDuplicateOwnerPhones,
};
