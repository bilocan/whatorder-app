const express = require('express');
const { requireOwnerOfBusiness } = require('../lib/dashboardAuth');
const {
  approveOrder, rejectOrder, startPreparation,
  markReady, markOnTheWay, markPickedUp, markDelivered, cancelOrder,
} = require('../bot/orderService');
const { getReceiptDownload, resendReceiptWhatsApp } = require('../lib/receiptService');
const { refundOrderPayment } = require('../lib/paymentService');

const router = express.Router();

router.use('/businesses/:businessId/orders/:orderId', requireOwnerOfBusiness);

function transitionHttpStatus(message) {
  if (message === 'Order not found') return 404;
  if (
    message.startsWith('Invalid transition') ||
    message.startsWith('Payment required') ||
    message.startsWith('Missing stripePaymentIntentId')
  ) {
    return 409;
  }
  if (message === 'Stripe is not configured') return 503;
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

// Ablehnen: auto full refund when Stripe paid, then reject. Cancel does NOT refund.
router.post('/businesses/:businessId/orders/:orderId/reject', async (req, res) => {
  const { businessId, orderId } = req.params;
  try {
    const refund = await refundOrderPayment(businessId, orderId, {
      reason: 'owner_reject',
      actor: 'owner',
      notifyCustomer: false,
    });
    await rejectOrder(businessId, orderId, { paymentRefunded: Boolean(refund.refunded) });
    res.json({ status: 'ok', refunded: Boolean(refund.refunded) });
  } catch (err) {
    res.status(transitionHttpStatus(err.message)).json({ error: err.message });
  }
});

router.post('/businesses/:businessId/orders/:orderId/prepare',    handleTransition(startPreparation));
router.post('/businesses/:businessId/orders/:orderId/ready',      handleTransition(markReady));
router.post('/businesses/:businessId/orders/:orderId/on-the-way', handleTransition(markOnTheWay));
router.post('/businesses/:businessId/orders/:orderId/picked-up',  handleTransition(markPickedUp));
router.post('/businesses/:businessId/orders/:orderId/delivered',  handleTransition(markDelivered));
router.post('/businesses/:businessId/orders/:orderId/cancel',     handleTransition(cancelOrder));

// Manual full refund (e.g. after preparing). Does not change kitchen status.
router.post('/businesses/:businessId/orders/:orderId/refund', async (req, res) => {
  const { businessId, orderId } = req.params;
  try {
    const result = await refundOrderPayment(businessId, orderId, {
      reason: 'owner_manual',
      actor: 'owner',
      notifyCustomer: true,
    });
    if (!result.refunded) {
      return res.status(409).json({ error: 'Order is not a paid Stripe charge', ...result });
    }
    res.json({ status: 'ok', ...result });
  } catch (err) {
    res.status(transitionHttpStatus(err.message)).json({ error: err.message });
  }
});

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
