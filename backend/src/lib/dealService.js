const crypto = require('crypto');
const { db, admin } = require('./firebase');
const { businessRef, dealsRef, dealRef } = require('./collections');
const { defaultDealLabel, toMillis } = require('./dealResolve');

const KIND_BY_PARAM = {
  'first-order': { slotKey: 'firstOrder', kind: 'first_order' },
  window: { slotKey: 'window', kind: 'window' },
};

function parseDealKindParam(kindParam) {
  return KIND_BY_PARAM[kindParam] || null;
}

function requireKind(kindParam) {
  const parsed = parseDealKindParam(kindParam);
  if (!parsed) throw { status: 400, message: 'Invalid deal kind' };
  return parsed;
}

function toIso(value) {
  const ms = toMillis(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function nowTimestamp(now) {
  if (now && typeof now.toMillis === 'function') return now;
  const date = now instanceof Date ? now : now ? new Date(now) : new Date();
  return admin.firestore.Timestamp.fromDate(date);
}

function toTimestamp(value) {
  if (value == null) return null;
  if (typeof value.toMillis === 'function' && typeof value.toDate === 'function') return value;
  const ms = toMillis(value);
  if (ms == null) return null;
  return admin.firestore.Timestamp.fromMillis(ms);
}

function isSet(value) {
  return value != null && value !== '';
}

function validateDealBody(kind, body) {
  const discountType = body?.discountType;
  if (discountType !== 'percent' && discountType !== 'fixed') {
    throw { status: 400, message: 'discountType must be percent or fixed' };
  }

  const value = body?.discountValue;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw { status: 400, message: 'discountValue must be a finite number' };
  }

  if (discountType === 'percent') {
    if (!(value > 0 && value <= 100)) {
      throw { status: 400, message: 'percent discountValue must be > 0 and <= 100' };
    }
    if (Math.round(value * 10) / 10 !== value) {
      throw { status: 400, message: 'percent discountValue allows at most one decimal' };
    }
  } else if (!(value > 0)) {
    throw { status: 400, message: 'fixed discountValue must be > 0' };
  }

  let label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (!label) {
    label = defaultDealLabel({ discountType, discountValue: value });
  }

  const startSet = isSet(body?.startsAt);
  const endSet = isSet(body?.endsAt);
  const startMs = startSet ? toMillis(body.startsAt) : null;
  const endMs = endSet ? toMillis(body.endsAt) : null;

  if (kind === 'window') {
    if (!startSet || !endSet) {
      throw { status: 400, message: 'window deal requires startsAt and endsAt' };
    }
    if (startMs == null || endMs == null) {
      throw { status: 400, message: 'window startsAt and endsAt must be parseable dates' };
    }
    if (!(endMs > startMs)) {
      throw { status: 400, message: 'endsAt must be after startsAt' };
    }
  } else if (startSet || endSet) {
    if (startMs == null || endMs == null) {
      throw { status: 400, message: 'first-order startsAt and endsAt must both be parseable when either is set' };
    }
    if (!(endMs > startMs)) {
      throw { status: 400, message: 'endsAt must be after startsAt' };
    }
  }

  return {
    discountType,
    discountValue: value,
    label,
    startsAt: startMs != null ? new Date(startMs) : null,
    endsAt: endMs != null ? new Date(endMs) : null,
  };
}

function serializeSlot(slot) {
  if (!slot) return null;
  return {
    dealId: slot.dealId,
    kind: slot.kind,
    discountType: slot.discountType,
    discountValue: slot.discountValue,
    label: slot.label,
    startsAt: toIso(slot.startsAt),
    endsAt: toIso(slot.endsAt),
    active: slot.active,
    updatedAt: toIso(slot.updatedAt),
  };
}

function serializeHistory(data) {
  if (!data) return null;
  return {
    ...serializeSlot(data),
    status: data.status,
    createdAt: toIso(data.createdAt),
    endedAt: toIso(data.endedAt),
    createdBy: data.createdBy ?? null,
  };
}

function liveSlotFrom(dealId, kind, validated, nowTs) {
  return {
    dealId,
    kind,
    discountType: validated.discountType,
    discountValue: validated.discountValue,
    label: validated.label,
    startsAt: toTimestamp(validated.startsAt),
    endsAt: toTimestamp(validated.endsAt),
    active: true,
    updatedAt: nowTs,
  };
}

function hasLiveSlot(slot) {
  return Boolean(slot && slot.dealId);
}

async function listDeals(businessId) {
  const bizSnap = await businessRef(businessId).get();
  const deals = bizSnap.exists ? (bizSnap.data().deals || {}) : {};
  const histSnap = await dealsRef(businessId).orderBy('createdAt', 'desc').limit(20).get();
  return {
    firstOrder: serializeSlot(deals.firstOrder || null),
    window: serializeSlot(deals.window || null),
    history: histSnap.docs.map((doc) => serializeHistory(doc.data())),
  };
}

async function upsertDeal({ businessId, kindParam, body, uid, now }) {
  const { slotKey, kind } = requireKind(kindParam);
  const nowTs = nowTimestamp(now);

  await db.runTransaction(async (tx) => {
    const bizRef = businessRef(businessId);
    const bizSnap = await tx.get(bizRef);
    if (!bizSnap.exists) throw { status: 404, message: 'Business not found' };

    const validated = validateDealBody(kind, body);
    const dealId = crypto.randomUUID();
    const deals = { ...(bizSnap.data().deals || {}) };
    const prev = deals[slotKey];

    if (hasLiveSlot(prev)) {
      tx.update(dealRef(businessId, prev.dealId), {
        status: 'ended',
        endedAt: nowTs,
      });
    }

    const live = liveSlotFrom(dealId, kind, validated, nowTs);
    tx.set(dealRef(businessId, dealId), {
      ...live,
      status: 'active',
      createdAt: nowTs,
      createdBy: uid || null,
    });
    deals[slotKey] = live;
    tx.update(bizRef, { deals });
  });
  return listDeals(businessId);
}

async function setDealActive({ businessId, kindParam, active, uid, now }) {
  const { slotKey } = requireKind(kindParam);
  if (typeof active !== 'boolean') {
    throw { status: 400, message: 'active must be a boolean' };
  }
  const nowTs = nowTimestamp(now);

  await db.runTransaction(async (tx) => {
    const bizRef = businessRef(businessId);
    const bizSnap = await tx.get(bizRef);
    if (!bizSnap.exists) throw { status: 404, message: 'Business not found' };

    const deals = { ...(bizSnap.data().deals || {}) };
    const slot = deals[slotKey];
    if (!hasLiveSlot(slot)) throw { status: 404, message: 'No live deal' };

    const updated = { ...slot, active, updatedAt: nowTs };
    deals[slotKey] = updated;
    tx.update(bizRef, { deals });
    tx.update(dealRef(businessId, slot.dealId), {
      active,
      status: active ? 'active' : 'paused',
      updatedAt: nowTs,
    });
  });
  return listDeals(businessId);
}

async function endDeal({ businessId, kindParam, uid, now }) {
  const { slotKey } = requireKind(kindParam);
  const nowTs = nowTimestamp(now);

  await db.runTransaction(async (tx) => {
    const bizRef = businessRef(businessId);
    const bizSnap = await tx.get(bizRef);
    if (!bizSnap.exists) throw { status: 404, message: 'Business not found' };

    const deals = { ...(bizSnap.data().deals || {}) };
    const slot = deals[slotKey];
    if (!hasLiveSlot(slot)) throw { status: 404, message: 'No live deal' };

    tx.update(dealRef(businessId, slot.dealId), {
      status: 'ended',
      endedAt: nowTs,
    });
    deals[slotKey] = null;
    tx.update(bizRef, { deals });
  });
  return listDeals(businessId);
}

module.exports = {
  parseDealKindParam,
  validateDealBody,
  listDeals,
  upsertDeal,
  setDealActive,
  endDeal,
};
