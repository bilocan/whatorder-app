const { ordersRef, businessRef, customersRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');
const { sendText } = require('../lib/whatsapp');
const { t } = require('./templates');

// Valid source states for each target status
const VALID_FROM = {
  approved:   ['pending'],
  rejected:   ['pending'],
  preparing:  ['approved'],
  ready:      ['preparing'],
  on_the_way: ['preparing'],
  picked_up:  ['ready'],
  delivered:  ['on_the_way'],
  cancelled:  ['pending', 'approved', 'preparing'],
};

const STATUS_TS_FIELD = {
  approved:   'approvedAt',
  rejected:   'rejectedAt',
  preparing:  'preparingAt',
  ready:      'readyAt',
  on_the_way: 'onTheWayAt',
  picked_up:  'pickedUpAt',
  delivered:  'deliveredAt',
  cancelled:  'cancelledAt',
};

const STATUS_NOTIFY_KEY = {
  approved:   'orderApproved',
  rejected:   'orderRejected',
  preparing:  'orderPreparing',
  ready:      'orderReady',
  on_the_way: 'orderOnTheWay',
  picked_up:  'orderPickedUp',
  delivered:  'orderDelivered',
  cancelled:  'orderCancelled',
};

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
    if (biz?.alertPhone) {
      const shortId = ref.id.slice(-6).toUpperCase();
      const itemLines = items.map(i => `• ${i.qty}x ${i.name} — €${(i.price * i.qty).toFixed(2)}`).join('\n');
      const typeLabel = doc.orderType === 'delivery' ? '🚚 Delivery' : '🛍️ Pickup';
      const addressLine = doc.deliveryAddress ? `\nAddress: ${doc.deliveryAddress}` : '';
      const ownerMsg = `🔔 New Order #${shortId} (${typeLabel})\n\n${itemLines}\n\nTotal: €${doc.total.toFixed(2)}${addressLine}\nCustomer: ${resolvedName} (${customerPhone})`;
      await sendText(biz.alertPhone, ownerMsg);
    }
  } catch (err) {
    console.error('Owner notification failed:', err.message);
  }

  return ref.id;
}

async function transitionOrder(businessId, orderId, toStatus) {
  const ref = ordersRef(businessId).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');

  const order = snap.data();
  const validFrom = VALID_FROM[toStatus];
  if (!validFrom || !validFrom.includes(order.status)) {
    throw new Error(`Invalid transition: ${order.status} → ${toStatus}`);
  }

  await ref.update({
    status: toStatus,
    [STATUS_TS_FIELD[toStatus]]: new Date().toISOString(),
  });

  try {
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    await sendText(order.customerPhone, t(STATUS_NOTIFY_KEY[toStatus], lang, shortId));
  } catch (err) {
    console.error('Customer notification failed:', err.message);
  }
}

const approveOrder      = (bid, oid) => transitionOrder(bid, oid, 'approved');
const rejectOrder       = (bid, oid) => transitionOrder(bid, oid, 'rejected');
const startPreparation  = (bid, oid) => transitionOrder(bid, oid, 'preparing');
const markReady         = (bid, oid) => transitionOrder(bid, oid, 'ready');
const markOnTheWay      = (bid, oid) => transitionOrder(bid, oid, 'on_the_way');
const markPickedUp      = (bid, oid) => transitionOrder(bid, oid, 'picked_up');
const markDelivered     = (bid, oid) => transitionOrder(bid, oid, 'delivered');
const cancelOrder       = (bid, oid) => transitionOrder(bid, oid, 'cancelled');

module.exports = {
  createOrder,
  approveOrder,
  rejectOrder,
  startPreparation,
  markReady,
  markOnTheWay,
  markPickedUp,
  markDelivered,
  cancelOrder,
};
