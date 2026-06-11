const { ordersRef, businessRef, customersRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');

async function createOrder(businessId, { customerPhone, customerName, items, total, language, pickupTime, notes, orderType, deliveryAddress, deliveryFee }) {
  const ref = ordersRef(businessId).doc();
  const resolvedName = customerName || 'WhatsApp Customer';
  const doc = {
    id: ref.id,
    customerId: customerPhone,
    customerPhone,
    customerName: resolvedName,
    items,
    total,
    language: language || 'en',
    status: 'pending',
    source: 'whatsapp',
    orderType: orderType || 'pickup',
    pickupTime: pickupTime || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (notes) doc.notes = notes;
  if (orderType === 'delivery' && deliveryAddress) {
    doc.deliveryAddress = deliveryAddress;
    doc.deliveryFee = deliveryFee || 0;
    doc.total = total + (deliveryFee || 0);
  }
  await ref.set(doc);

  // Upsert customer profile
  try {
    const customerDoc = customersRef(businessId).doc(customerPhone);
    await customerDoc.set({
      phone: customerPhone,
      name: resolvedName,
      lastOrderDate: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await customerDoc.update({
      orderCount: admin.firestore.FieldValue.increment(1),
      totalSpent: admin.firestore.FieldValue.increment(doc.total),
    });
    if (orderType === 'delivery' && deliveryAddress) {
      await customerDoc.update({
        lastDeliveryAddress: deliveryAddress,
        savedAddresses: admin.firestore.FieldValue.arrayUnion(deliveryAddress),
      });
    }
  } catch (err) {
    console.error('Customer profile upsert failed:', err.message);
  }

  // Notify owner
  try {
    const bizSnap = await businessRef(businessId).get();
    const biz = bizSnap.exists ? bizSnap.data() : null;
    if (biz?.phone) {
      const shortId = ref.id.slice(-6).toUpperCase();
      const itemLines = items.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');
      const typeLabel = doc.orderType === 'delivery' ? '🚚 Delivery' : '🛍️ Pickup';
      const addressLine = doc.deliveryAddress ? `\nAddress: ${doc.deliveryAddress}` : '';
      const ownerMsg = `🔔 New Order #${shortId} (${typeLabel})\n\n${itemLines}\n\nTotal: €${doc.total.toFixed(2)}${addressLine}\nCustomer: ${resolvedName} (${customerPhone})`;
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
