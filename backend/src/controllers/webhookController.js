const { handleMessage } = require('../bot/botHandler');
const { phoneRoutingRef } = require('../lib/collections');

async function resolveBusinessId(phoneNumberId) {
  if (phoneNumberId) {
    const snap = await phoneRoutingRef(phoneNumberId).get();
    if (snap.exists) return snap.data().businessId;
  }
  return process.env.BUSINESS_ID || 'biz_test';
}

function verifyWebhook(req, res) {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Invalid token');
  }
}

async function receiveWebhook(req, res) {
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const msg = change?.messages?.[0];

  if (!msg) {
    const statuses = change?.statuses;
    if (statuses) {
      console.log(`[webhook] status update: ${statuses.map(s => `${s.status}/${s.id}`).join(', ')}`);
    } else {
      console.log('[webhook] non-message event received', JSON.stringify(req.body?.entry?.[0]?.changes?.[0]?.field ?? req.body));
    }
    res.status(200).json({ status: 'ok' });
    return;
  }

  const from = msg.from;
  const contactName = change?.contacts?.[0]?.profile?.name ?? null;
  const phoneNumberId = change?.metadata?.phone_number_id ?? null;
  console.log(`[webhook] message type=${msg.type} phone_number_id=${phoneNumberId} from=${from}`);

  let message;
  if (msg.type === 'text') {
    message = { type: 'text', text: msg.text?.body ?? '' };
  } else if (msg.type === 'interactive') {
    const iType = msg.interactive?.type;
    if (iType === 'list_reply') {
      const lr = msg.interactive.list_reply;
      message = { type: 'list_reply', id: lr.id, title: lr.title };
    } else if (iType === 'button_reply') {
      const br = msg.interactive.button_reply;
      message = { type: 'button_reply', id: br.id, title: br.title };
    } else {
      res.status(200).json({ status: 'ok' });
      return;
    }
  } else if (msg.type === 'order') {
    const items = (msg.order?.product_items ?? []).map(p => ({
      productId: p.product_retailer_id,
      qty: p.quantity,
      price: p.item_price,
      currency: p.currency,
    }));
    message = { type: 'cart_submitted', items };
  } else {
    res.status(200).json({ status: 'ok' });
    return;
  }

  try {
    const businessId = await resolveBusinessId(phoneNumberId);
    await handleMessage(businessId, { from, contactName, ...message });
  } catch (err) {
    const metaError = err.response?.data ? JSON.stringify(err.response.data) : null;
    console.error('Bot error:', metaError ?? err.message ?? err);
  }

  res.status(200).json({ status: 'success' });
}

module.exports = { verifyWebhook, receiveWebhook };
