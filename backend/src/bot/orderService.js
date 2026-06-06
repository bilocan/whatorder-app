const { ordersRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');

// items: [{ name, qty, price }] — matches dashboard's OrderItem schema
async function createOrder(businessId, { customerPhone, customerName, items, total }) {
  const ref = ordersRef(businessId).doc();
  await ref.set({
    id: ref.id,
    customerId: customerPhone,
    customerPhone,
    customerName: customerName || 'WhatsApp Customer',
    items,
    total,
    status: 'pending',
    source: 'whatsapp',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

module.exports = { createOrder };
