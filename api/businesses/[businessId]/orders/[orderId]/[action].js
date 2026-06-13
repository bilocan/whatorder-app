const {
  approveOrder, rejectOrder, startPreparation,
  markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder,
} = require('../../../../../backend/src/bot/orderService');

const ACTION_MAP = {
  approve:    approveOrder,
  reject:     rejectOrder,
  prepare:    startPreparation,
  ready:      markReady,
  'on-the-way': markOnTheWay,
  'picked-up':  markPickedUp,
  delivered:  markDelivered,
  cancel:     cancelOrder,
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { businessId, orderId, action } = req.query;
  const fn = ACTION_MAP[action];
  if (!fn) return res.status(404).json({ error: `Unknown action: ${action}` });

  try {
    await fn(businessId, orderId);
    res.json({ status: 'ok' });
  } catch (err) {
    const status = err.message === 'Order not found' ? 404
      : err.message.startsWith('Invalid transition') ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
};
