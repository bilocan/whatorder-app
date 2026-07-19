const { ordersRef, businessRef, customersRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');
const { sendText, sendButtonMessage } = require('../lib/whatsapp');
const { resolvePhoneNumberIdForOrder, formatOrderWhatsAppSendError } = require('../lib/whatsappRouting');
const { runWithMessageIdentity, applyBusinessInfoIdentity, PLATFORM_IDENTITY } = require('../lib/messageIdentity');
const { formatBasketItemsText } = require('./botHelpers');
const { t } = require('./templates');
const { normalizeCustomerPhone, customerPhoneVariants } = require('../lib/phone');
const { patchSession } = require('./sessionStore');

const TERMINAL_REENTRY_STATUSES = new Set(['delivered', 'picked_up']);

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

async function createOrder(businessId, { customerPhone, customerName, restaurantName, items, total, language, pickupTime, notes, orderType, deliveryAddress, deliveryFee, paymentMethod, paymentStatus, whatsappPhoneNumberId }) {
  const ref = ordersRef(businessId).doc();
  const resolvedName = customerName || 'WhatsApp Customer';
  const phone = normalizeCustomerPhone(customerPhone) || customerPhone;
  const doc = {
    id: ref.id,
    customerId: phone,
    customerPhone: phone,
    customerName: resolvedName,
    restaurantName: restaurantName || null,
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
    const phoneNumberId = resolvePhoneNumberIdForOrder(doc, businessId, ref.id);
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
    const msg = err.name === 'WhatsAppRoutingError'
      ? err.message
      : formatOrderWhatsAppSendError(err, { orderId: ref.id, businessId, phoneNumberId: doc.whatsappPhoneNumberId, kind: 'Owner notification' });
    console.error(msg);
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
    const phoneNumberId = resolvePhoneNumberIdForOrder(order, businessId, orderId);
    const shortId = orderId.slice(-6).toUpperCase();
    const lang = order.language || 'en';
    const notifyArgs = toStatus === 'approved' ? [shortId, etaTime] : [shortId];
    const bizSnap = await businessRef(businessId).get();
    await runWithMessageIdentity(PLATFORM_IDENTITY, async () => {
      applyBusinessInfoIdentity(bizSnap.exists ? bizSnap.data() : { name: order.restaurantName });
      const statusText = t(STATUS_NOTIFY_KEY[toStatus], lang, ...notifyArgs);
      if (TERMINAL_REENTRY_STATUSES.has(toStatus)) {
        // Re-open ordering after the meal (no Cancel — order is finished).
        await sendButtonMessage(order.customerPhone, {
          body: `${statusText}\n\n${t('orderCompletePrompt', lang)}`,
          buttons: [
            { id: 'btn_post_reorder', title: t('postReorderBtn', lang) },
            { id: 'btn_post_restaurant', title: t('postCompleteRestaurantBtn', lang) },
          ],
        }, phoneNumberId);
        // Multi clears businessId after place; restore restaurant context for btn_post_*.
        try {
          await patchSession(order.customerPhone, { pendingAmendBusinessId: businessId });
        } catch (patchErr) {
          console.error('[orderService] post-complete session patch failed:', patchErr.message);
        }
      } else {
        await sendText(order.customerPhone, statusText, phoneNumberId);
      }
    });
  } catch (err) {
    const msg = err.name === 'WhatsAppRoutingError'
      ? err.message
      : formatOrderWhatsAppSendError(err, { orderId, businessId, phoneNumberId: order.whatsappPhoneNumberId, kind: 'Customer status notification' });
    console.error(msg);
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

async function getOrder(businessId, orderId) {
  const snap = await ordersRef(businessId).doc(orderId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Add items to a pending cash order (M4 amend window). Re-notifies owner on success.
 * @returns {{ applied: object[], total: number }}
 */
async function amendOrderAddItems(businessId, orderId, newItems) {
  const ref = ordersRef(businessId).doc(orderId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found');

  const order = snap.data();
  if (order.status !== 'pending') throw new Error('Order not amendable');
  if (order.paymentMethod === 'stripe') throw new Error('Card orders not self-serve amendable');
  if (!newItems?.length) return { applied: [], total: order.total };

  const mergedItems = [...(order.items || []), ...newItems];
  const subtotal = mergedItems.reduce((s, i) => s + (i.price * i.qty), 0);
  const deliveryFee = order.deliveryFee || 0;
  const total = order.orderType === 'delivery' ? subtotal + deliveryFee : subtotal;

  await ref.update({
    items: mergedItems,
    total,
    amendedAt: new Date().toISOString(),
  });

  try {
    const phoneNumberId = resolvePhoneNumberIdForOrder(order, businessId, orderId);
    const bizSnap = await businessRef(businessId).get();
    const biz = bizSnap.exists ? bizSnap.data() : null;
    if (biz?.alertPhone) {
      const shortId = orderId.slice(-6).toUpperCase();
      const addedLines = formatBasketItemsText(newItems, { numbered: false, mergeIdentical: true });
      const ownerMsg = `✏️ Order #${shortId} amended (add-on)\n\nAdded:\n${addedLines}\n\nNew total: €${total.toFixed(2)}\nCustomer: ${order.customerName} (${order.customerPhone})`;
      await sendText(biz.alertPhone, ownerMsg, phoneNumberId);
    }
  } catch (err) {
    const msg = err.name === 'WhatsAppRoutingError'
      ? err.message
      : formatOrderWhatsAppSendError(err, { orderId, businessId, phoneNumberId: order.whatsappPhoneNumberId, kind: 'Owner amend notification' });
    console.error(msg);
  }

  return { applied: newItems, total };
}

module.exports = {
  getLastOrderForCustomer,
  getOrder,
  createOrder,
  amendOrderAddItems,
  approveOrder,
  rejectOrder,
  startPreparation,
  markReady,
  markOnTheWay,
  markPickedUp,
  markDelivered,
  cancelOrder,
};
