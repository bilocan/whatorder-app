const { ordersRef, businessRef, customersRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');
const { sendText } = require('../lib/whatsapp');
const { resolvePhoneNumberIdForOrder } = require('../lib/whatsappRouting');
const { formatBasketItemsText } = require('./botHelpers');
const { t } = require('./templates');
const { normalizeCustomerPhone, customerPhoneVariants } = require('../lib/phone');

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

const EXCLUDED_REORDER_STATUSES = new Set(['cancelled', 'rejected']);

async function getLastOrderForCustomer(businessId, customerPhone) {
  const variants = customerPhoneVariants(customerPhone);
  if (!variants.length) return null;

  let orders = [];
  for (const field of ['customerId', 'customerPhone']) {
    const snap = await ordersRef(businessId)
      .where(field, 'in', variants.slice(0, 10))
      .limit(25)
      .get();
    if (!snap.empty) {
      orders = snap.docs.map(doc => doc.data());
      break;
    }
  }
  if (!orders.length) return null;

  orders = orders
    .filter(o => !EXCLUDED_REORDER_STATUSES.has(o.status))
    .sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds * 1000 ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds * 1000 ?? 0;
      return bMs - aMs;
    });

  const latest = orders[0];
  if (!latest?.items?.length) return null;
  return latest;
}

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

async function createOrder(businessId, { customerPhone, customerName, items, total, language, pickupTime, notes, orderType, deliveryAddress, deliveryFee, paymentMethod, paymentStatus, whatsappPhoneNumberId }) {
  const ref = ordersRef(businessId).doc();
  const resolvedName = customerName || 'WhatsApp Customer';
  const phone = normalizeCustomerPhone(customerPhone) || customerPhone;
  const doc = {
    id: ref.id,
    customerId: phone,
    customerPhone: phone,
    customerName: resolvedName,
    items,
    total,
    language: language || 'en',
    status: 'pending',
    source: 'whatsapp',
    orderType: orderType || 'pickup',
    pickupTime: pickupTime || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    paymentMethod: paymentMethod || 'cash',
    paymentStatus: paymentStatus || (paymentMethod === 'stripe' ? 'pending' : 'cash'),
    settlementStatus: 'none',
  };
  if (whatsappPhoneNumberId) doc.whatsappPhoneNumberId = whatsappPhoneNumberId;
  if (notes) doc.notes = notes;
  if (orderType === 'delivery' && deliveryAddress) {
    doc.deliveryAddress = deliveryAddress;
    doc.deliveryFee = deliveryFee || 0;
    doc.total = total + (deliveryFee || 0);
  }
  await ref.set(doc);

  // Upsert customer profile
  try {
    const customerDoc = customersRef(businessId).doc(phone);
    await customerDoc.set({
      phone,
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
    const phoneNumberId = await resolvePhoneNumberIdForOrder(doc, businessId);
    const bizSnap = await businessRef(businessId).get();
    const biz = bizSnap.exists ? bizSnap.data() : null;
    if (biz?.alertPhone) {
      const shortId = ref.id.slice(-6).toUpperCase();
      const itemLines = formatBasketItemsText(items, { numbered: false, mergeIdentical: true });
      const typeLabel = doc.orderType === 'delivery' ? '🚚 Delivery' : '🛍️ Pickup';
      const addressLine = doc.deliveryAddress ? `\nAddress: ${doc.deliveryAddress}` : '';
      const ownerMsg = `🔔 New Order #${shortId} (${typeLabel})\n\n${itemLines}\n\nTotal: €${doc.total.toFixed(2)}${addressLine}\nCustomer: ${resolvedName} (${phone})`;
      await sendText(biz.alertPhone, ownerMsg, phoneNumberId);
    }
  } catch (err) {
    console.error('Owner notification failed:', err.message);
  }

  return ref.id;
}

async function transitionOrder(businessId, orderId, toStatus, options = {}) {
  const ref = ordersRef(businessId).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');

  const order = snap.data();
  const validFrom = VALID_FROM[toStatus];
  if (!validFrom || !validFrom.includes(order.status)) {
    throw new Error(`Invalid transition: ${order.status} → ${toStatus}`);
  }

  const update = {
    status: toStatus,
    [STATUS_TS_FIELD[toStatus]]: new Date().toISOString(),
  };

  let etaTime = null;
  if (toStatus === 'approved') {
    const prepMins = Number(options.etaMinutes) > 0 ? Number(options.etaMinutes) : (order.prepMins || 30);
    const bizSnap = await businessRef(businessId).get();
    const timezone = bizSnap.exists ? (bizSnap.data().timezone || 'Europe/Vienna') : 'Europe/Vienna';
    etaTime = new Date(Date.now() + prepMins * 60000).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
    update.prepMins = prepMins;
    update.pickupTime = etaTime;
  }

  await ref.update(update);

  try {
    const phoneNumberId = await resolvePhoneNumberIdForOrder(order, businessId);
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    const notifyArgs = toStatus === 'approved' ? [shortId, etaTime] : [shortId];
    await sendText(order.customerPhone, t(STATUS_NOTIFY_KEY[toStatus], lang, ...notifyArgs), phoneNumberId);
  } catch (err) {
    console.error('Customer notification failed:', err.message);
  }
}

const approveOrder      = (bid, oid, etaMinutes) => transitionOrder(bid, oid, 'approved', { etaMinutes });
const rejectOrder       = (bid, oid) => transitionOrder(bid, oid, 'rejected');
const startPreparation  = (bid, oid) => transitionOrder(bid, oid, 'preparing');
const markReady         = (bid, oid) => transitionOrder(bid, oid, 'ready');
const markOnTheWay      = (bid, oid) => transitionOrder(bid, oid, 'on_the_way');
const markPickedUp      = (bid, oid) => transitionOrder(bid, oid, 'picked_up');
const markDelivered     = (bid, oid) => transitionOrder(bid, oid, 'delivered');
const cancelOrder       = (bid, oid) => transitionOrder(bid, oid, 'cancelled');

module.exports = {
  getLastOrderForCustomer,
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
