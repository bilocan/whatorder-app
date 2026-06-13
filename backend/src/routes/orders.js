const express = require('express');
const {
  approveOrder, rejectOrder, startPreparation,
  markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder,
} = require('../bot/orderService');

const router = express.Router();

function handleTransition(fn) {
  return async (req, res) => {
    const { businessId, orderId } = req.params;
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
}

router.post('/businesses/:businessId/orders/:orderId/approve',    handleTransition(approveOrder));
router.post('/businesses/:businessId/orders/:orderId/reject',     handleTransition(rejectOrder));
router.post('/businesses/:businessId/orders/:orderId/prepare',    handleTransition(startPreparation));
router.post('/businesses/:businessId/orders/:orderId/ready',      handleTransition(markReady));
router.post('/businesses/:businessId/orders/:orderId/on-the-way', handleTransition(markOnTheWay));
router.post('/businesses/:businessId/orders/:orderId/picked-up',  handleTransition(markPickedUp));
router.post('/businesses/:businessId/orders/:orderId/delivered',  handleTransition(markDelivered));
router.post('/businesses/:businessId/orders/:orderId/cancel',     handleTransition(cancelOrder));

module.exports = router;
