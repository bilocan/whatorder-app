const express = require('express');
const { requireAdmin } = require('../lib/adminAuth');
const {
  exportRestaurantBundle,
  startImportUpload,
  previewImportBundle,
  runImportBundle,
} = require('../lib/restaurantBundle/exportImport');

const router = express.Router();

function sendErr(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('[admin/restaurant-bundle]', err);
  res.status(status).json({ error: err.message || 'Restaurant bundle failed' });
}

router.post('/restaurants/:id/export', requireAdmin, async (req, res) => {
  try {
    const profile = req.body?.profile === 'full' ? 'full' : 'setup';
    const result = await exportRestaurantBundle({
      businessId: req.params.id,
      profile,
      adminUid: req.adminUid,
    });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/restaurants/import/upload-url', requireAdmin, async (req, res) => {
  try {
    const result = await startImportUpload({ adminUid: req.adminUid });
    res.json({
      uploadUrl: result.uploadUrl,
      importToken: result.importToken,
      objectKey: result.objectKey,
    });
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/restaurants/import/preview', requireAdmin, async (req, res) => {
  try {
    const preview = await previewImportBundle({
      importToken: req.body?.importToken,
      adminUid: req.adminUid,
      body: req.body,
    });
    res.json(preview);
  } catch (err) {
    sendErr(res, err);
  }
});

router.post('/restaurants/import', requireAdmin, async (req, res) => {
  try {
    const result = await runImportBundle({
      importToken: req.body?.importToken,
      adminUid: req.adminUid,
      body: req.body,
    });
    res.json(result);
  } catch (err) {
    sendErr(res, err);
  }
});

module.exports = router;
