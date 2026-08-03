'use strict';

const {
  approveOrder,
  startPreparation,
  markReady,
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

module.exports = {
  ownerApprove,
  ownerStartPreparation,
  ownerMarkReady,
};
