const { handleMessage } = require('../bot/botHandler');
const { phoneRoutingRef, processedMessageRef } = require('../lib/collections');
const { admin } = require('../lib/firebase');
const { assertWebhookSignature } = require('../lib/whatsappWebhookSecurity');

async function resolveRouting(phoneNumberId) {
  if (phoneNumberId) {
    const snap = await phoneRoutingRef(phoneNumberId).get();
    if (snap.exists) {
      const data = snap.data();
      const ids = Array.isArray(data.businessIds) ? data.businessIds : [];
      return { businessIds: ids, defaultBusinessId: data.defaultBusinessId ?? null, phoneNumberId };
    }
    return { businessIds: [], defaultBusinessId: null, phoneNumberId };
  }
  return { businessIds: [], defaultBusinessId: null, phoneNumberId: null };
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
  const sig = assertWebhookSignature(req);
  if (!sig.ok) {
    console.warn(`[webhook] signature rejected: ${sig.message}`);
    res.status(sig.status).json({ error: sig.message });
    return;
  }

  console.log('[webhook] POST received', req.method, req.url);
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
  const wamid = msg.id ?? null;
  const contactName = change?.contacts?.[0]?.profile?.name ?? null;
  const phoneNumberId = change?.metadata?.phone_number_id ?? null;
  console.log(`[webhook] message type=${msg.type} phone_number_id=${phoneNumberId} wamid=${wamid ?? 'n/a'}`);

  if (wamid) {
    const prior = await processedMessageRef(wamid).get();
    if (prior.exists) {
      console.log(`[webhook] duplicate wamid=${wamid}, skipping`);
      res.status(200).json({ status: 'ok' });
      return;
    }
  }

  let message;
  if (msg.type === 'text') {
    message = { type: 'text', text: msg.text?.body ?? '' };
  } else if (msg.type === 'interactive') {
    const interactive = msg.interactive ?? {};
    const iType = interactive.type;
    if (iType === 'list_reply') {
      const lr = interactive.list_reply;
      if (!lr?.id) {
        console.warn('[webhook] list_reply missing id', JSON.stringify(interactive));
        res.status(200).json({ status: 'ok' });
        return;
      }
      message = { type: 'list_reply', id: lr.id, title: lr.title ?? '' };
    } else if (iType === 'button_reply') {
      const br = interactive.button_reply;
      if (!br?.id) {
        console.warn('[webhook] button_reply missing id', JSON.stringify(interactive));
        res.status(200).json({ status: 'ok' });
        return;
      }
      message = { type: 'button_reply', id: br.id, title: br.title ?? '' };
    } else if (iType === 'nfm_reply') {
      let flowData = {};
      try { flowData = JSON.parse(msg.interactive.nfm_reply?.response_json ?? '{}'); } catch {}
      message = { type: 'flow_completion', data: flowData };
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
  } else if (msg.type === 'location') {
    const loc = msg.location;
    message = { type: 'location', latitude: loc?.latitude ?? null, longitude: loc?.longitude ?? null };
  } else {
    res.status(200).json({ status: 'ok' });
    return;
  }

  // Process before responding — Vercel terminates the function as soon as res.json() is called,
  // so any async work after res.send() is silently dropped. Normal processing is well under Meta's 20s retry threshold.
  try {
    const routing = await resolveRouting(phoneNumberId);
    await handleMessage(routing, { from, contactName, ...message });
    if (wamid) {
      const businessId = routing.defaultBusinessId
        ?? (routing.businessIds?.length === 1 ? routing.businessIds[0] : null);
      await processedMessageRef(wamid).set({
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        businessId,
      });
    }
  } catch (err) {
    const metaError = err.response?.data ? JSON.stringify(err.response.data) : null;
    console.error('Bot error:', metaError ?? err.message ?? err);
  }

  res.status(200).json({ status: 'success' });
}

module.exports = { verifyWebhook, receiveWebhook };
