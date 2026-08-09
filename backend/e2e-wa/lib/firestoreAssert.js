'use strict';

const {
  ordersRef,
  sessionRef,
  businessRef,
  customersRef,
} = require('../../src/lib/collections');
const { customerPhoneVariants, normalizeCustomerPhone } = require('../../src/lib/phone');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function orderCreatedMs(order) {
  const c = order.createdAt;
  if (!c) return 0;
  if (typeof c.toMillis === 'function') return c.toMillis();
  if (c.seconds != null) return c.seconds * 1000;
  if (typeof c === 'string') return Date.parse(c) || 0;
  if (typeof c === 'number') return c;
  return 0;
}

/**
 * Poll until a new order appears for the E2E customer phone.
 * @param {{ businessId: string, customerDisplay: string, afterMs?: number, status?: string|null, paymentMethod?: string|null, orderType?: string|null, timeoutMs?: number, pollMs?: number }} opts
 * @returns {Promise<{ id: string, [key: string]: any }>}
 */
async function waitForOrder(opts) {
  const {
    businessId,
    customerDisplay,
    afterMs = 0,
    status = 'pending',
    paymentMethod = null,
    orderType = null,
    timeoutMs = 90_000,
    pollMs = 1500,
  } = opts;

  const variants = customerPhoneVariants(customerDisplay);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const hit = await findLatestOrder(
      businessId,
      variants,
      {
        afterMs,
        status,
        paymentMethod,
        orderType,
      },
    );
    if (hit) return hit;
    await sleep(pollMs);
  }

  throw new Error(
    `waitForOrder timed out after ${timeoutMs}ms `
    + `(businessId=${businessId}, customer=${normalizeCustomerPhone(customerDisplay)}, `
    + `status=${status}${paymentMethod ? `, paymentMethod=${paymentMethod}` : ''}`
    + `${orderType ? `, orderType=${orderType}` : ''})`,
  );
}

/**
 * Assert no new order appears within timeout (negatives).
 */
async function assertNoNewOrder(opts) {
  const {
    businessId,
    customerDisplay,
    afterMs = 0,
    timeoutMs = 45_000,
    pollMs = 1500,
  } = opts;

  const variants = customerPhoneVariants(customerDisplay);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await findLatestOrder(businessId, variants, { afterMs, status: null });
    if (hit) {
      throw new Error(`Unexpected order ${hit.id} (status=${hit.status}) during negative scenario`);
    }
    await sleep(pollMs);
  }
}

async function findLatestOrder(
  businessId,
  variants,
  {
    afterMs,
    status,
    paymentMethod = null,
    orderType = null,
  },
) {
  if (!variants.length) return null;

  const phoneSlice = variants.slice(0, 10);
  let docs = [];

  for (const field of ['customerPhone', 'customerId']) {
    // Prefer createdAt desc so nightly history cannot bury the newest order.
    try {
      let q = ordersRef(businessId).where(field, 'in', phoneSlice);
      if (afterMs > 0) {
        q = q.where('createdAt', '>', new Date(afterMs));
      }
      const snap = await q.orderBy('createdAt', 'desc').limit(10).get();
      if (!snap.empty) {
        docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        break;
      }
    } catch (err) {
      // Missing composite index (FAILED_PRECONDITION) — fall back below.
      if (err.code !== 9) throw err;
    }

    try {
      const snap = await ordersRef(businessId)
        .where(field, 'in', phoneSlice)
        .limit(50)
        .get();
      if (!snap.empty) {
        docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        break;
      }
    } catch (err) {
      if (err.code !== 9) throw err;
    }
  }

  const filtered = docs
    .filter((o) => orderCreatedMs(o) > afterMs)
    .filter((o) => (status == null ? true : o.status === status))
    .filter((o) => (paymentMethod == null ? true : o.paymentMethod === paymentMethod))
    .filter((o) => (orderType == null ? true : o.orderType === orderType))
    .sort((a, b) => orderCreatedMs(b) - orderCreatedMs(a));

  return filtered[0] || null;
}

async function waitForOrderStatus(businessId, orderId, status, { timeoutMs = 30_000, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await ordersRef(businessId).doc(orderId).get();
    if (snap.exists && snap.data().status === status) {
      return { id: snap.id, ...snap.data() };
    }
    await sleep(pollMs);
  }
  throw new Error(`waitForOrderStatus timed out waiting for ${orderId} → ${status}`);
}

/**
 * Mark a Stripe order paid via Admin SDK (no Checkout UI).
 * Used by owner_status_path before kitchen transitions; mirrors the product rule
 * that unpaid Stripe orders should not advance (gate itself is separate eng work).
 *
 * @param {string} businessId
 * @param {string} orderId
 * @returns {Promise<{ id: string, [key: string]: any }>}
 */
async function markOrderPaid(businessId, orderId, opts = {}) {
  const ref = ordersRef(businessId).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`markOrderPaid: order not found ${orderId}`);
  const data = snap.data();
  if (opts.customerDisplay) {
    const allowed = new Set(customerPhoneVariants(opts.customerDisplay));
    const phone = String(data.customerPhone || data.customerId || '').replace(/\D/g, '');
    const ok = [...allowed].some((v) => String(v).replace(/\D/g, '') === phone);
    if (!ok) {
      throw new Error(
        `markOrderPaid: order ${orderId} customerPhone=${data.customerPhone} `
        + `does not match e2e customer ${opts.customerDisplay}`,
      );
    }
  }
  if (data.paymentStatus === 'paid') {
    return { id: snap.id, ...data };
  }
  await ref.update({
    paymentStatus: 'paid',
    paymentMethod: data.paymentMethod || 'stripe',
  });
  const after = await ref.get();
  return { id: after.id, ...after.data() };
}

/**
 * Remove persisted delivery addresses for the E2E customer.
 * @param {string} businessId
 * @param {string} customerDisplay
 */
async function clearLastDeliveryAddress(businessId, customerDisplay) {
  const customerId = normalizeCustomerPhone(customerDisplay);
  const ref = customersRef(businessId).doc(customerId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`clearLastDeliveryAddress: customer not found ${customerId}; no-op`);
    return;
  }

  const data = snap.data();
  const allowed = new Set(customerPhoneVariants(customerDisplay));
  const phone = String(data.phone || snap.id || '').replace(/\D/g, '');
  const ok = [...allowed].some((variant) => (
    String(variant).replace(/\D/g, '') === phone
  ));
  if (!ok) {
    throw new Error(
      `clearLastDeliveryAddress: customer ${snap.id} phone=${data.phone} `
      + `does not match e2e customer ${customerDisplay}`,
    );
  }

  const { admin } = require('../../src/lib/firebase');
  const deleteField = admin.firestore.FieldValue.delete();
  await ref.update({
    lastDeliveryAddress: deleteField,
    savedAddresses: deleteField,
  });
}

async function getSession(customerDisplay) {
  const digits = normalizeCustomerPhone(customerDisplay);
  const snap = await sessionRef(digits).get();
  if (!snap.exists) {
    const withPlus = await sessionRef(`+${digits}`).get();
    if (!withPlus.exists) return null;
    return { id: withPlus.id, ...withPlus.data() };
  }
  return { id: snap.id, ...snap.data() };
}

/**
 * Delete customer session doc(s) so ORDER+ starts clean (no stuck awaiting_location).
 * @param {string} customerDisplay
 */
async function resetCustomerSession(customerDisplay) {
  const digits = normalizeCustomerPhone(customerDisplay);
  const ids = [...new Set([digits, `+${digits}`].filter(Boolean))];
  await Promise.all(ids.map(async (id) => {
    const ref = sessionRef(id);
    const snap = await ref.get();
    if (snap.exists) await ref.delete();
  }));
}

/**
 * Poll customer session until predicate returns true.
 * @param {string} customerDisplay
 * @param {(session: object|null) => boolean} predicate
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 */
async function waitForSession(customerDisplay, predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 1000;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await getSession(customerDisplay);
    if (predicate(last)) return last;
    await sleep(pollMs);
  }
  throw new Error(
    `waitForSession timed out after ${timeoutMs}ms `
    + `(customer=${normalizeCustomerPhone(customerDisplay)}, `
    + `last=${JSON.stringify({
      state: last?.state,
      businessId: last?.businessId,
      basket: last?.basket?.length,
      pending: last?.pendingIntentItems?.length,
    })})`,
  );
}

/**
 * Temporarily patch business fields; restores on dispose.
 * @param {string} businessId
 * @param {Record<string, any>} patch
 */
async function withBusinessPatch(businessId, patch, fn) {
  const { admin } = require('../../src/lib/firebase');
  const ref = businessRef(businessId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Business ${businessId} not found`);
  const before = snap.data();
  await ref.update(patch);
  try {
    return await fn();
  } finally {
    const restore = {};
    for (const key of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(before, key)) {
        restore[key] = before[key];
      } else {
        restore[key] = admin.firestore.FieldValue.delete();
      }
    }
    await ref.update(restore);
  }
}

module.exports = {
  waitForOrder,
  assertNoNewOrder,
  waitForOrderStatus,
  markOrderPaid,
  clearLastDeliveryAddress,
  getSession,
  resetCustomerSession,
  waitForSession,
  withBusinessPatch,
  orderCreatedMs,
  findLatestOrder,
};
