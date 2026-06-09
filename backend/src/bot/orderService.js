const { ordersRef, businessRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');

async function createOrder(businessId, { customerPhone, customerName, items, total, language, pickupTime, notes }) {
  const ref = ordersRef(businessId).doc();
  const doc = {
    id: ref.id,
    customerId: customerPhone,
    customerPhone,
    customerName: customerName || 'WhatsApp Customer',
    items,
    total,
    language: language || 'en',
    status: 'pending',
    source: 'whatsapp',
    pickupTime: pickupTime || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (notes) doc.notes = notes;
  await ref.set(doc);

  // Notify owner
  try {
    const bizSnap = await businessRef(businessId).get();
    const biz = bizSnap.exists ? bizSnap.data() : null;
    if (biz?.phone) {
      const shortId = ref.id.slice(-6).toUpperCase();
      const itemLines = items.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');
      const ownerMsg = `🔔 New Order #${shortId}\n\n${itemLines}\n\nTotal: €${total.toFixed(2)}\nCustomer: ${customerName || 'Customer'} (${customerPhone})`;
      await sendText(biz.phone, ownerMsg);
    }
  } catch (err) {
    console.error('Owner notification failed:', err.message);
  }

  return ref.id;
}

async function markOrderReady(businessId, orderId) {
  const ref = ordersRef(businessId).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');

  const order = snap.data();
  if (order.status !== 'pending') throw new Error('Order is not pending');

  await ref.update({
    status: 'ready',
    readyAt: new Date().toISOString(),
  });

  // Notify customer
  try {
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    await sendText(order.customerPhone, t('orderReady', lang, shortId));
  } catch (err) {
    console.error('Customer notification failed:', err.message);
  }
}

module.exports = { createOrder, markOrderReady };
