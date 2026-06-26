const { phoneRoutingByBusinessQuery } = require('./collections');

function envPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || null;
}

/**
 * Meta tokens are scoped to a WABA — this server can only send via WHATSAPP_PHONE_NUMBER_ID.
 * Orders may carry whatsappPhoneNumberId from another deployment (e.g. Cloud Run prod vs local test).
 */
function resolveSendPhoneNumberId(storedId) {
  const envId = envPhoneNumberId();
  if (!storedId) return envId;
  if (!envId || storedId === envId) return storedId;
  console.warn(
    `[whatsappRouting] order whatsappPhoneNumberId=${storedId} differs from env ${envId}; using env (this server cannot send as stored number)`,
  );
  return envId;
}

/** Resolve Meta phone_number_id for outbound messages to a business's customers. */
async function resolvePhoneNumberIdForBusiness(businessId) {
  const envId = envPhoneNumberId();
  if (envId) return envId;
  if (!businessId) return null;

  try {
    const snap = await phoneRoutingByBusinessQuery(businessId).get();
    if (snap.empty) return null;
    return snap.docs[0].id;
  } catch (err) {
    console.error('[whatsappRouting] phoneRouting lookup failed:', err.message);
    return null;
  }
}

async function resolvePhoneNumberIdForOrder(order, businessId) {
  return resolveSendPhoneNumberId(order?.whatsappPhoneNumberId)
    ?? resolvePhoneNumberIdForBusiness(businessId);
}

module.exports = {
  envPhoneNumberId,
  resolveSendPhoneNumberId,
  resolvePhoneNumberIdForBusiness,
  resolvePhoneNumberIdForOrder,
};
