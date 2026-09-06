const PROTECTED_IMPORT_IDS = new Set(['biz_enes_kebap_9450w']);

function requiresNameConfirm({ targetBusinessId, isProduction }) {
  return Boolean(isProduction) || PROTECTED_IMPORT_IDS.has(targetBusinessId);
}

function assertNameConfirm({ confirmName, businessName, targetBusinessId, isProduction }) {
  if (!requiresNameConfirm({ targetBusinessId, isProduction })) return;
  const expected = String(businessName || '').trim();
  if (!expected || String(confirmName || '').trim() !== expected) {
    const err = new Error('Type the restaurant name to confirm');
    err.status = 400;
    throw err;
  }
}

module.exports = {
  PROTECTED_IMPORT_IDS,
  requiresNameConfirm,
  assertNameConfirm,
};
