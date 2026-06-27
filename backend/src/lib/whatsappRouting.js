class WhatsAppRoutingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WhatsAppRoutingError';
  }
}

/**
 * Resolve the Meta phone_number_id for order-related outbound messages.
 * Uses only the ID stored on the order at placement (from webhook metadata).
 * No env or phoneRouting fallback — wrong-number sends are worse than a loud failure.
 */
function resolvePhoneNumberIdForOrder(order, businessId, orderId = order?.id) {
  const id = order?.whatsappPhoneNumberId;
  if (!id) {
    throw new WhatsAppRoutingError(
      `Order ${orderId ?? 'unknown'} (business ${businessId}) has no whatsappPhoneNumberId. `
      + 'Order notifications must send from the WhatsApp number the customer used to place the order. '
      + 'Ensure the order is created via the bot webhook flow (metadata.phone_number_id → session → order).',
    );
  }
  return id;
}

function formatOrderWhatsAppSendError(err, { orderId, businessId, phoneNumberId, kind }) {
  const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
  return (
    `[order] ${kind} failed for order ${orderId} (business ${businessId}, phone_number_id ${phoneNumberId}): ${detail}. `
    + 'Verify WHATSAPP_ACCESS_TOKEN on this server is permitted to send from that Meta phone number ID.'
  );
}

module.exports = {
  WhatsAppRoutingError,
  resolvePhoneNumberIdForOrder,
  formatOrderWhatsAppSendError,
};
