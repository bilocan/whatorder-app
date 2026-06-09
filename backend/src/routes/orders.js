const express = require('express');
const { markOrderReady } = require('../bot/orderService');

const router = express.Router();

router.post('/businesses/:businessId/orders/:orderId/ready', async (req, res) => {
  const { businessId, orderId } = req.params;
  try {
    await markOrderReady(businessId, orderId);
    res.json({ status: 'ok' });
  } catch (err) {
    const status = err.message === 'Order not found' ? 404
      : err.message === 'Order is not pending' ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

// Legacy alias — kept for backward compat with any existing clients
router.post('/orders/:orderId/ready', async (req, res) => {
  const { orderId } = req.params;
  const businessId = process.env.BUSINESS_ID || 'biz_test';
  try {
    await markOrderReady(businessId, orderId);
    res.json({ status: 'ok' });
  } catch (err) {
    const status = err.message === 'Order not found' ? 404
      : err.message === 'Order is not pending' ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
