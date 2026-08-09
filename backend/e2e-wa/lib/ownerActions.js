'use strict';

const {
  approveOrder,
  startPreparation,
  markReady,
  cancelOrder,
  getOrder,
} = require('../../src/bot/orderService');

async function ownerApprove(businessId, orderId, { etaMinutes = 20 } = {}) {
  await approveOrder(businessId, orderId, etaMinutes);
  return getOrder(businessId, orderId);
}

async function ownerStartPreparation(businessId, orderId) {
  await startPreparation(businessId, orderId);
  return getOrder(businessId, orderId);
}

async function ownerMarkReady(businessId, orderId) {
  await markReady(businessId, orderId);
  return getOrder(businessId, orderId);
}

/** Cancel kitchen order; skipReentry avoids extra WA reorder CTAs during e2e teardown. */
async function ownerCancel(businessId, orderId, { skipReentry = true } = {}) {
  await cancelOrder(businessId, orderId, { skipReentry });
  return getOrder(businessId, orderId);
}

module.exports = {
  ownerApprove,
  ownerStartPreparation,
  ownerMarkReady,
  ownerCancel,
};
