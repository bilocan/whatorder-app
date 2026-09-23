const { wallboardFeedRef } = require('./collections');
const { admin } = require('./firebase');

function boardStatus(order) {
  const status = order?.status;
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'picked_up' || status === 'delivered' || status === 'completed') return 'completed';
  if (order?.paymentMethod === 'stripe' && (order.paymentStatus === 'pending' || order.paymentStatus === 'failed')) {
    return 'pending_payment';
  }
  return 'in_progress';
}

async function writeWallboardFeedOnCreate(businessId, orderId, order, firstOrder) {
  try {
    await wallboardFeedRef(orderId).set({
      businessId,
      restaurantName: order.restaurantName || '',
      total: Number(order.total) || 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      boardStatus: boardStatus(order),
      paymentStatus: order.paymentStatus || '',
      firstOrder: firstOrder === true,
    });
  } catch (err) {
    console.error(`[wallboard] feed create failed businessId=${businessId} orderId=${orderId}: ${err.message}`);
  }
}

async function updateWallboardFeedIfExists(orderId, order) {
  try {
    const ref = wallboardFeedRef(orderId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const patch = {
      boardStatus: boardStatus(order),
      paymentStatus: order.paymentStatus || '',
    };
    if (typeof order.total === 'number') patch.total = order.total;
    await ref.set(patch, { merge: true });
  } catch (err) {
    console.error(`[wallboard] feed update failed orderId=${orderId}: ${err.message}`);
  }
}

module.exports = { boardStatus, writeWallboardFeedOnCreate, updateWallboardFeedIfExists };
