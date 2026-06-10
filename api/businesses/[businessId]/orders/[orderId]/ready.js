const { markOrderReady } = require('../../../../backend/src/bot/orderService');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { businessId, orderId } = req.query;
  try {
    await markOrderReady(businessId, orderId);
    res.json({ status: 'ok' });
  } catch (err) {
    const status = err.message === 'Order not found' ? 404
      : err.message === 'Order is not pending' ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
};
