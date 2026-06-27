const express = require('express');
const { requireAdmin } = require('../lib/adminAuth');
const { runPayoutBatch } = require('../lib/payoutService');
const { getSettlementConfig, resolveConnectMode } = require('../lib/settlementConfig');

const router = express.Router();

// POST /admin/payouts/run — admin-only weekly batch (mock Connect by default)
router.post('/payouts/run', requireAdmin, async (req, res) => {
  const dryRun = Boolean(req.body?.dryRun);
  try {
    const result = await runPayoutBatch({ dryRun });
    res.json(result);
  } catch (err) {
    console.error('[admin/payouts/run]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/payouts/config — settlement config + effective connect mode
router.get('/payouts/config', requireAdmin, async (_req, res) => {
  const config = await getSettlementConfig();
  res.json({ ...config, effectiveConnectMode: resolveConnectMode(config) });
});

module.exports = router;
