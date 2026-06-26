const { phoneRoutingByBusinessQuery } = require('./collections');

function envPhoneNumberId() {
  return process.env.WHATSAPP_PHONE_NUMBER_ID || null;
}

/** Prefer the number the customer messaged; fall back to this server's env. */
function resolveSendPhoneNumberId(storedId) {
  if (storedId) return storedId;
  return envPhoneNumberId();
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
  const fromOrder = resolveSendPhoneNumberId(order?.whatsappPhoneNumberId);
  if (fromOrder) return fromOrder;
  return resolvePhoneNumberIdForBusiness(businessId);
}

module.exports = {
  envPhoneNumberId,
  resolveSendPhoneNumberId,
  resolvePhoneNumberIdForBusiness,
  resolvePhoneNumberIdForOrder,
};
