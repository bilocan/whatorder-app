const { phoneRoutingByBusinessQuery } = require('./collections');

/** Resolve Meta phone_number_id for outbound messages to a business's customers. */
async function resolvePhoneNumberIdForBusiness(businessId) {
  if (!businessId) return process.env.WHATSAPP_PHONE_NUMBER_ID || null;

  try {
    const snap = await phoneRoutingByBusinessQuery(businessId).get();
    if (snap.empty) return process.env.WHATSAPP_PHONE_NUMBER_ID || null;
    if (snap.size === 1) return snap.docs[0].id;
    const envId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const match = snap.docs.find(d => d.id === envId);
    if (match) return match.id;
    return snap.docs[0].id;
  } catch (err) {
    console.error('[whatsappRouting] phoneRouting lookup failed:', err.message);
    return process.env.WHATSAPP_PHONE_NUMBER_ID || null;
  }
}

async function resolvePhoneNumberIdForOrder(order, businessId) {
  if (order?.whatsappPhoneNumberId) return order.whatsappPhoneNumberId;
  return resolvePhoneNumberIdForBusiness(businessId);
}

module.exports = { resolvePhoneNumberIdForBusiness, resolvePhoneNumberIdForOrder };
