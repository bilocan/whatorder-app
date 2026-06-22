const express = require('express');
const { businessRef, phoneRoutingRef } = require('../lib/collections');
const { getSession } = require('../bot/sessionStore');
const { buildKeypadContext } = require('../bot/keypadActions');
const { applyKeypadAction } = require('../bot/keypadApply');

const router = express.Router();

const LANGS = new Set(['de', 'en', 'tr']);

function digitsOnly(phone) {
  return (phone ?? '').replace(/\D/g, '');
}

async function resolveWhatsAppNumber() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) return null;
  const snap = await phoneRoutingRef(phoneNumberId).get();
  if (!snap.exists) return null;
  const display = snap.data()?.displayNumber;
  const digits = digitsOnly(display);
  return digits || null;
}

function sessionContext(session, businessId, lang) {
  if (!session) return null;
  if (session.businessId && session.businessId !== businessId) return null;
  return buildKeypadContext(session, lang);
}

/** Public POC: keypad config + optional live session context for a customer phone. */
router.get('/api/keypad/:businessId', async (req, res) => {
  const { businessId } = req.params;
  const lang = LANGS.has(req.query.lang) ? req.query.lang : 'de';
  const customerPhone = digitsOnly(req.query.customer);

  try {
    const bizSnap = await businessRef(businessId).get();
    if (!bizSnap.exists) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    const whatsappNumber = await resolveWhatsAppNumber();
    if (!whatsappNumber) {
      return res.status(503).json({
        error: 'WhatsApp display number not configured',
        hint: 'Set displayNumber on phoneRouting/{WHATSAPP_PHONE_NUMBER_ID}',
      });
    }

    const business = bizSnap.data();
    const payload = {
      businessId,
      name: business.name ?? 'Restaurant',
      whatsappNumber,
      lang,
      context: null,
    };

    if (customerPhone) {
      const session = await getSession(customerPhone);
      payload.context = sessionContext(session, businessId, lang);
    }

    return res.json(payload);
  } catch (err) {
    console.error('[keypad]', err);
    return res.status(500).json({ error: 'Failed to load keypad' });
  }
});

/** Apply basket action on server (stay on keypad). Checkout / place order may return openWhatsApp. */
router.post('/api/keypad/:businessId/apply', async (req, res) => {
  const { businessId } = req.params;
  const lang = LANGS.has(req.body?.lang) ? req.body.lang : 'de';
  const customerPhone = digitsOnly(req.body?.customer);
  const action = req.body?.action;

  if (!customerPhone) {
    return res.status(400).json({ ok: false, error: 'customer_required' });
  }
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'action_required' });
  }

  try {
    const bizSnap = await businessRef(businessId).get();
    if (!bizSnap.exists) {
      return res.status(404).json({ ok: false, error: 'restaurant_not_found' });
    }

    const result = await applyKeypadAction(customerPhone, businessId, lang, action, {
      text: req.body?.text,
      menuItemId: req.body?.menuItemId,
      qty: req.body?.qty,
    });

    const status = result.ok ? 200 : 400;
    return res.status(status).json(result);
  } catch (err) {
    console.error('[keypad apply]', err);
    return res.status(500).json({ ok: false, error: 'apply_failed' });
  }
});

module.exports = router;
