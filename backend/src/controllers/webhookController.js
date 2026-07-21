const { handleMessage } = require('../bot/botHandler');
const { phoneRoutingRef, processedMessageRef } = require('../lib/collections');
const { admin, db } = require('../lib/firebase');
const { assertWebhookSignature } = require('../lib/whatsappWebhookSecurity');
const { redactLogValue } = require('../lib/logRedact');

/** Stale "processing" claims older than this may be stolen by a Meta retry after a crash/hang. */
const CLAIM_STALE_MS = 45_000;

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

function claimTimestampMs(data) {
  const at = data?.processedAt;
  if (!at) return 0;
  if (typeof at.toMillis === 'function') return at.toMillis();
  if (typeof at.toDate === 'function') return at.toDate().getTime();
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return at;
  return 0;
}

/**
 * Atomically claim a wamid before handleMessage.
 * @returns {Promise<'claimed'|'duplicate'>}
 */
async function claimProcessedMessage(wamid, businessId) {
  const ref = processedMessageRef(wamid);
  const payload = {
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    businessId: businessId ?? null,
    status: 'processing',
  };

  try {
    await ref.create(payload);
    return 'claimed';
  } catch (claimErr) {
    if (!isAlreadyExistsError(claimErr)) throw claimErr;
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, payload);
      return 'claimed';
    }
    const data = snap.data() ?? {};
    const status = data.status === 'processing' ? 'processing' : 'done';
    const age = Date.now() - claimTimestampMs(data);

    if (status === 'done') return 'duplicate';
    if (status === 'processing' && age < CLAIM_STALE_MS) return 'duplicate';

    // Steal stale processing claim (crash / hung turn before done/delete).
    tx.set(ref, payload);
    return 'claimed';
  });
}

async function markProcessedMessageDone(wamid) {
  await processedMessageRef(wamid).set({ status: 'done' }, { merge: true });
}

async function releaseProcessedMessage(wamid) {
  await processedMessageRef(wamid).delete();
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
      console.log('[webhook] non-message event received', redactLogValue(req.body?.entry?.[0]?.changes?.[0]?.field ?? req.body));
    }
    res.status(200).json({ status: 'ok' });
    return;
  }

  const from = msg.from;
  const wamid = msg.id ?? null;
  const contactName = change?.contacts?.[0]?.profile?.name ?? null;
  const phoneNumberId = change?.metadata?.phone_number_id ?? null;
  console.log(`[webhook] message type=${msg.type} phone_number_id=${phoneNumberId} wamid=${wamid ?? 'n/a'}`);

  let message;
  if (msg.type === 'text') {
    message = { type: 'text', text: msg.text?.body ?? '' };
  } else if (msg.type === 'interactive') {
    const interactive = msg.interactive ?? {};
    const iType = interactive.type;
    if (iType === 'list_reply') {
      const lr = interactive.list_reply;
      if (!lr?.id) {
        console.warn('[webhook] list_reply missing id', redactLogValue(interactive));
        res.status(200).json({ status: 'ok' });
        return;
      }
      message = { type: 'list_reply', id: lr.id, title: lr.title ?? '' };
    } else if (iType === 'button_reply') {
      const br = interactive.button_reply;
      if (!br?.id) {
        console.warn('[webhook] button_reply missing id', redactLogValue(interactive));
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

  // Claim wamid before handleMessage so Meta retries during a slow/hung turn
  // cannot race and send duplicate WhatsApp replies (check-then-set was racy).
  // Stale "processing" claims (>45s) may be stolen so a crash mid-turn is not silent forever.
  // Process before responding — Vercel terminates as soon as res.json() is called.
  let claimedWamid = false;
  try {
    const routing = await resolveRouting(phoneNumberId);
    const businessId = routing.defaultBusinessId
      ?? (routing.businessIds?.length === 1 ? routing.businessIds[0] : null);

    if (wamid) {
      const claim = await claimProcessedMessage(wamid, businessId);
      if (claim === 'duplicate') {
        console.log(`[webhook] duplicate wamid=${wamid}, skipping`);
        res.status(200).json({ status: 'ok' });
        return;
      }
      claimedWamid = true;
    }

    await handleMessage(routing, { from, contactName, ...message });
    if (claimedWamid && wamid) {
      await markProcessedMessageDone(wamid);
    }
  } catch (err) {
    const metaError = err.response?.data ? JSON.stringify(err.response.data) : null;
    console.error('Bot error:', metaError ?? err.message ?? err);
    // Release so a later delivery (or steal after TTL) can retry. HTTP stays 200 —
    // Meta does not redeliver on 2xx; concurrent duplicates and TTL steal cover recovery.
    if (claimedWamid && wamid) {
      try {
        await releaseProcessedMessage(wamid);
      } catch (delErr) {
        console.warn(`[webhook] failed to release wamid=${wamid}: ${delErr.message}`);
      }
    }
  }

  res.status(200).json({ status: 'success' });
}

function isAlreadyExistsError(err) {
  const code = err?.code;
  return code === 6
    || code === 'already-exists'
    || code === 'ALREADY_EXISTS'
    || /already exists/i.test(String(err?.message ?? ''));
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
  isAlreadyExistsError,
  claimProcessedMessage,
  CLAIM_STALE_MS,
};
