const express = require('express');
const { requireOwnerOfBusiness } = require('../lib/dashboardAuth');
const {
  approveOrder, rejectOrder, startPreparation,
  markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder,
} = require('../bot/orderService');
const { getReceiptDownload, resendReceiptWhatsApp } = require('../lib/receiptService');

const router = express.Router();

router.use('/businesses/:businessId/orders/:orderId', requireOwnerOfBusiness);

function transitionHttpStatus(message) {
  if (message === 'Order not found') return 404;
  if (
    message.startsWith('Invalid transition') ||
    message.startsWith('Payment required')
  ) {
    return 409;
  }
  return 500;
}

function receiptHttpStatus(err) {
  if (err.code === 'NOT_FOUND') return 404;
  if (err.code === 'CONFLICT') return 409;
  return 500;
}

function handleTransition(fn) {
  return async (req, res) => {
    const { businessId, orderId } = req.params;
    try {
      await fn(businessId, orderId);
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(transitionHttpStatus(err.message)).json({ error: err.message });
    }
  };
}

router.post('/businesses/:businessId/orders/:orderId/approve', async (req, res) => {
  const { businessId, orderId } = req.params;
  try {
    await approveOrder(businessId, orderId, req.body?.etaMinutes);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(transitionHttpStatus(err.message)).json({ error: err.message });
  }
});
router.post('/businesses/:businessId/orders/:orderId/reject',     handleTransition(rejectOrder));
router.post('/businesses/:businessId/orders/:orderId/prepare',    handleTransition(startPreparation));
router.post('/businesses/:businessId/orders/:orderId/ready',      handleTransition(markReady));
router.post('/businesses/:businessId/orders/:orderId/on-the-way', handleTransition(markOnTheWay));
router.post('/businesses/:businessId/orders/:orderId/picked-up',  handleTransition(markPickedUp));
router.post('/businesses/:businessId/orders/:orderId/delivered',  handleTransition(markDelivered));
router.post('/businesses/:businessId/orders/:orderId/cancel',     handleTransition(cancelOrder));

router.get('/businesses/:businessId/orders/:orderId/receipt', async (req, res) => {
  const { businessId, orderId } = req.params;
  try {
    const result = await getReceiptDownload(businessId, orderId);
    res.json(result);
  } catch (err) {
    res.status(receiptHttpStatus(err)).json({ error: err.message });
  }
});

router.post('/businesses/:businessId/orders/:orderId/receipt/resend', async (req, res) => {
  const { businessId, orderId } = req.params;
  try {
    const result = await resendReceiptWhatsApp(businessId, orderId);
    res.json(result);
  } catch (err) {
    res.status(receiptHttpStatus(err)).json({ error: err.message });
  }
});

module.exports = router;
