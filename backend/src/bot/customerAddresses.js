const { customersRef } = require('../lib/collections');

const MAX_SAVED_ADDRESSES = 5;
const GENERIC_ERROR_KEY = 'confirmFlowErrorManageGeneric';

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Distinct saved labels in profile order (trim + lowercase dedupe). */
function normalizeSavedList(savedAddresses = []) {
  const seen = new Set();
  const ordered = [];
  for (const addr of Array.isArray(savedAddresses) ? savedAddresses : []) {
    const label = trimmed(addr);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(label);
  }
  return ordered;
}

/**
 * Labels the manage screen can act on: the saved list plus a legacy `lastDeliveryAddress`
 * that was never mirrored into `savedAddresses` (older place-order writes).
 */
function mutableLabels(profile) {
  const labels = Array.isArray(profile.savedAddresses) ? [...profile.savedAddresses] : [];
  const last = trimmed(profile.lastDeliveryAddress);
  if (last && !labels.includes(profile.lastDeliveryAddress)) {
    labels.push(profile.lastDeliveryAddress);
  }
  return labels;
}

function findExactLabel(labels, label) {
  const target = trimmed(label);
  if (!target) return null;
  for (const addr of Array.isArray(labels) ? labels : []) {
    if (addr === target) return addr;
  }
  return null;
}

function hasDistinctLabel(savedAddresses, label) {
  const target = trimmed(label).toLowerCase();
  if (!target) return false;
  return normalizeSavedList(savedAddresses).some(
    (addr) => addr.toLowerCase() === target,
  );
}

async function loadCustomerDoc(phone, businessId) {
  const snap = await customersRef(businessId).doc(phone).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  return {
    savedAddresses: Array.isArray(data.savedAddresses) ? data.savedAddresses : [],
    lastDeliveryAddress: data.lastDeliveryAddress ?? null,
  };
}

async function loadCustomerAddresses(phone, businessId) {
  const profile = await loadCustomerDoc(phone, businessId);
  return {
    savedAddresses: [...profile.savedAddresses],
    lastDeliveryAddress: profile.lastDeliveryAddress,
  };
}

/**
 * `set(..., { merge: true })` also covers the first-order customer whose doc does not exist
 * yet — `update()` would reject with NOT_FOUND.
 */
async function writeProfile(phone, businessId, patch) {
  await customersRef(businessId).doc(phone).set(patch, { merge: true });
}

/** Firestore failures surface as a visible manage error instead of a 500 / silent close. */
async function guarded(run) {
  try {
    return await run();
  } catch (err) {
    console.error('[customerAddresses] profile write failed', err);
    return { ok: false, errorKey: GENERIC_ERROR_KEY };
  }
}

function successPayload(profile) {
  return {
    ok: true,
    savedAddresses: [...(profile.savedAddresses ?? [])],
    lastDeliveryAddress: profile.lastDeliveryAddress ?? null,
  };
}

/** In-place replace keeps radio order stable and lets the edit land in a single write. */
function replaceLabelInList(savedAddresses, oldLabel, nextLabel) {
  const list = Array.isArray(savedAddresses) ? [...savedAddresses] : [];
  const index = list.indexOf(oldLabel);
  if (index === -1) {
    list.push(nextLabel);
  } else {
    list[index] = nextLabel;
  }
  return normalizeSavedList(list);
}

async function saveCustomerAddress({ phone, businessId, label, replaceLabel }) {
  const nextLabel = trimmed(label);
  if (!nextLabel) {
    return { ok: false, errorKey: 'confirmFlowErrorAddress' };
  }

  return guarded(async () => {
    const profile = await loadCustomerDoc(phone, businessId);

    if (replaceLabel != null && replaceLabel !== '') {
      const exactOld = findExactLabel(mutableLabels(profile), replaceLabel);
      if (!exactOld) {
        return { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
      }
      if (exactOld === nextLabel) {
        return successPayload(profile);
      }

      const patch = {
        savedAddresses: replaceLabelInList(profile.savedAddresses, exactOld, nextLabel),
      };
      if (profile.lastDeliveryAddress === exactOld) {
        patch.lastDeliveryAddress = nextLabel;
      }

      await writeProfile(phone, businessId, patch);
      return successPayload(await loadCustomerDoc(phone, businessId));
    }

    if (hasDistinctLabel(profile.savedAddresses, nextLabel)) {
      return successPayload(profile);
    }

    if (normalizeSavedList(profile.savedAddresses).length >= MAX_SAVED_ADDRESSES) {
      return { ok: false, errorKey: 'confirmFlowErrorManageCap' };
    }

    await writeProfile(phone, businessId, {
      savedAddresses: normalizeSavedList([...profile.savedAddresses, nextLabel]),
    });

    return successPayload(await loadCustomerDoc(phone, businessId));
  });
}

async function setDefaultCustomerAddress({ phone, businessId, label }) {
  return guarded(async () => {
    const profile = await loadCustomerDoc(phone, businessId);
    const exact = findExactLabel(mutableLabels(profile), label);
    if (!exact) {
      return { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
    }

    const patch = { lastDeliveryAddress: exact };
    // Legacy default that only lived in lastDeliveryAddress joins the saved list so the
    // row stays actionable (edit / delete) on the next manage render.
    if (!profile.savedAddresses.includes(exact)) {
      patch.savedAddresses = [...profile.savedAddresses, exact];
    }

    await writeProfile(phone, businessId, patch);
    return successPayload(await loadCustomerDoc(phone, businessId));
  });
}

async function deleteCustomerAddress({ phone, businessId, label }) {
  return guarded(async () => {
    const profile = await loadCustomerDoc(phone, businessId);
    const exact = findExactLabel(mutableLabels(profile), label);
    if (!exact) {
      return { ok: false, errorKey: 'confirmFlowErrorManageSelect' };
    }

    const remaining = profile.savedAddresses.filter((addr) => addr !== exact);
    const patch = { savedAddresses: remaining };

    if (profile.lastDeliveryAddress === exact) {
      patch.lastDeliveryAddress = remaining.length > 0
        ? remaining[remaining.length - 1]
        : null;
    }

    await writeProfile(phone, businessId, patch);
    return successPayload(await loadCustomerDoc(phone, businessId));
  });
}

module.exports = {
  loadCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
  deleteCustomerAddress,
};
