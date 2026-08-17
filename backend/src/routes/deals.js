const express = require('express');
const { requireOwnerOfBusiness } = require('../lib/dashboardAuth');
const {
  listDeals,
  upsertDeal,
  setDealActive,
  endDeal,
  parseDealKindParam,
  validateDealBody,
} = require('../lib/dealService');

const router = express.Router();
router.use('/businesses/:businessId/deals', requireOwnerOfBusiness);

function handleDealError(res, err, fallback) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('[deals]', err.message);
  return res.status(500).json({ error: fallback });
}

async function putDeal(req, res, kindParam) {
  try {
    const parsed = parseDealKindParam(kindParam);
    if (!parsed) throw { status: 400, message: 'Invalid deal kind' };
    validateDealBody(parsed.kind, req.body);
    const live = await upsertDeal({
      businessId: req.params.businessId,
      kindParam,
      body: req.body,
      uid: req.uid,
    });
    res.json(live);
  } catch (err) {
    handleDealError(res, err, 'Failed to save deal');
  }
}

router.get('/businesses/:businessId/deals', async (req, res) => {
  try {
    res.json(await listDeals(req.params.businessId));
  } catch (err) {
    handleDealError(res, err, 'Failed to load deals');
  }
});

router.put('/businesses/:businessId/deals/first-order', (req, res) => {
  return putDeal(req, res, 'first-order');
});

router.put('/businesses/:businessId/deals/window', (req, res) => {
  return putDeal(req, res, 'window');
});

router.post('/businesses/:businessId/deals/:kind/pause', async (req, res) => {
  try {
    const result = await setDealActive({
      businessId: req.params.businessId,
      kindParam: req.params.kind,
      active: req.body?.active,
      uid: req.uid,
    });
    res.json(result);
  } catch (err) {
    handleDealError(res, err, 'Failed to pause deal');
  }
});

router.post('/businesses/:businessId/deals/:kind/end', async (req, res) => {
  try {
    const result = await endDeal({
      businessId: req.params.businessId,
      kindParam: req.params.kind,
      uid: req.uid,
    });
    res.json(result);
  } catch (err) {
    handleDealError(res, err, 'Failed to end deal');
  }
});

module.exports = router;
