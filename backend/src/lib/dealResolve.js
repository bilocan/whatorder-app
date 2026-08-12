const { ordersRef } = require('./collections');
const { normalizeCustomerPhone } = require('./phone');
const { eurosToCents } = require('./receiptMath');

const FO_BURN_STATUSES = ['delivered', 'picked_up'];

function toMillis(value) {
  if (value == null) return null;
  let ms;
  if (typeof value.toMillis === 'function') {
    ms = value.toMillis();
  } else if (typeof value.seconds === 'number') {
    ms = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'number') {
    ms = value;
  } else {
    ms = Date.parse(value);
  }
  return Number.isFinite(ms) ? ms : null;
}

function inRange(slot, nowMs) {
  const start = toMillis(slot.startsAt);
  const end = toMillis(slot.endsAt);
  if (start != null && nowMs < start) return false;
  if (end != null && nowMs > end) return false;
  return true;
}

function defaultDealLabel(slot) {
  if (slot.discountType === 'percent') return `${slot.discountValue}% Rabatt`;
  const euros = Number(slot.discountValue);
  return `€${euros.toFixed(2)} Rabatt`;
}

function isLiveSlot(slot, expectedKind, nowMs, { requireWindowDates }) {
  if (!slot || slot.active !== true) return false;
  if (slot.kind !== expectedKind) return false;
  if (slot.discountType !== 'percent' && slot.discountType !== 'fixed') return false;
  if (typeof slot.discountValue !== 'number' || !Number.isFinite(slot.discountValue)) return false;
  const value = slot.discountValue;
  if (value <= 0) return false;
  if (slot.discountType === 'percent' && value > 100) return false;
  if (requireWindowDates) {
    if (toMillis(slot.startsAt) == null || toMillis(slot.endsAt) == null) return false;
    if (toMillis(slot.endsAt) <= toMillis(slot.startsAt)) return false;
  }
  return inRange(slot, nowMs);
}

function computeDiscountCents(slot, subtotalCents) {
  if (subtotalCents <= 0) return 0;
  if (slot.discountType === 'percent') {
    return Math.round(subtotalCents * Number(slot.discountValue) / 100);
  }
  return Math.min(eurosToCents(slot.discountValue, 'discountValue'), subtotalCents);
}

function toResult(slot, subtotal) {
  const subtotalCents = eurosToCents(subtotal, 'subtotal');
  const discountCents = Math.min(computeDiscountCents(slot, subtotalCents), subtotalCents);
  return {
    dealId: slot.dealId,
    kind: slot.kind,
    discountType: slot.discountType,
    discountValue: slot.discountValue,
    label: slot.label || defaultDealLabel(slot),
    discountCents,
    discount: discountCents / 100,
  };
}

async function hasCompletedOrder(businessId, customerId) {
  const phone = normalizeCustomerPhone(customerId);
  if (!phone) return false;
  const snap = await ordersRef(businessId)
    .where('customerId', '==', phone)
    .where('status', 'in', FO_BURN_STATUSES)
    .limit(1)
    .get();
  if (!snap.empty) return true;
  // Legacy orders may still store +prefix customerId.
  const legacy = await ordersRef(businessId)
    .where('customerId', '==', `+${phone}`)
    .where('status', 'in', FO_BURN_STATUSES)
    .limit(1)
    .get();
  return !legacy.empty;
}

async function resolveDeal({ businessId, business, customerId, subtotal, now = new Date() }) {
  const slots = business?.deals;
  if (!slots) return null;
  const nowMs = toMillis(now) ?? Date.now();
  const foOk = isLiveSlot(slots.firstOrder, 'first_order', nowMs, { requireWindowDates: false });
  const winOk = isLiveSlot(slots.window, 'window', nowMs, { requireWindowDates: true });
  if (foOk) {
    try {
      const burned = await hasCompletedOrder(businessId, customerId);
      if (!burned) return toResult(slots.firstOrder, subtotal);
    } catch (err) {
      console.warn(
        '[dealResolve] First-order burn query failed; skipping first-order deal. Check Firestore indexes:',
        err.message,
      );
    }
  }
  if (winOk) return toResult(slots.window, subtotal);
  return null;
}

module.exports = { resolveDeal, defaultDealLabel, toMillis };
